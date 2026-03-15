/**
 * Rankings Generator — Custom points league (12-team H2H)
 *
 * REPLACEMENT LEVEL:
 *   Computed per starting slot for a 12-team league. Starter counts:
 *   C:12, 1B:12, 2B:12, 3B:12, SS:12, OF:36, UTIL:12, SP:60 (12×5), RP:12 (12×1).
 *   Hitters: greedy assignment — sort by WeeklyPoints, fill C then 1B, 2B, 3B, SS, OF, UTIL
 *   without using the same player twice; replacement = points of the Nth player in each slot.
 *   UTIL = best 12 remaining after fixed positions. Pitchers: replacement = Nth best in SP/RP pool.
 *
 * MISSING STATS (use projections if present, else estimate):
 *   Hitter 1B = H - 2B - 3B - HR. Hitter HBP: PA * 0.01. Hitter GIDP: PA * 0.03 (reduce for SB).
 *   Pitcher OUT = IP * 3; score IP*1 + OUT*0.25. Pitcher HBP: BF * 0.01, BF ≈ IP*4.25.
 *   QS: not in CSV — estimate QS = GS * clamp(1 - (ERA-2.5)/3.5, 0.2, 0.75).
 *
 * Converts batters.csv and pitchers.csv into rankings.csv (all players, sorted by VORP).
 * VORP = WeeklyPoints - ReplacementWeeklyImpact (can be negative). No top-N cap.
 */

const fs = require("fs");
const path = require("path");

// --- League config (12-team H2H) ---
const WEEKS_PER_SEASON = 26;

// Starting slots per team → replacement rank = 12 * count (or 36 for OF)
const SLOT_COUNTS = {
  C: 12,
  "1B": 12,
  "2B": 12,
  "3B": 12,
  SS: 12,
  OF: 36,
  UTIL: 12,
  SP: 60,   // 12 teams × 5 SP
  RP: 12,   // 12 teams × 1 RP
};

const HITTER_SLOT_ORDER = ["C", "1B", "2B", "3B", "SS", "OF", "OF", "OF", "UTIL"]; // per team; we fill 12 of each except OF×36

// Events per week (for PointsPerEvent if needed)
const HITTER_EVENTS_PER_WEEK = 6.2;
const SP_EVENTS_PER_WEEK = 1.19;
const RP_EVENTS_PER_WEEK = 2.5;

// --- CSV helpers ---
function parseCSVLine(line) {
  const row = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let cell = "";
      while (i < line.length) {
        if (line[i] === '"') {
          i++;
          if (line[i] === '"') { cell += '"'; i++; }
          else break;
        } else { cell += line[i]; i++; }
      }
      row.push(cell);
      if (line[i] === ",") i++;
    } else {
      let cell = "";
      while (i < line.length && line[i] !== "," && line[i] !== "\r") {
        cell += line[i];
        i++;
      }
      row.push(cell.trim());
      if (line[i] === ",") i++;
    }
  }
  return row;
}

function escapeCSVCell(s) {
  if (String(s).indexOf(",") !== -1 || String(s).indexOf('"') !== -1) {
    return '"' + String(s).replace(/"/g, '""') + '"';
  }
  return String(s);
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((l) => parseCSVLine(l));
  return { headers, rows };
}

function getCol(row, headers, name) {
  const i = headers.indexOf(name);
  return i >= 0 ? row[i] : "";
}

function parseNum(val) {
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

// --- Hitter eligible slots from CSV Positions (Yahoo-style: "LF,CF,RF" or "DH" or "2B,3B,SS") ---
function getHitterEligibleSlots(positions) {
  const raw = String(positions || "")
    .toUpperCase()
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const slots = new Set();
  if (raw.length === 0) {
    slots.add("UTIL");
    return Array.from(slots);
  }
  const hasNonDH = raw.some((p) => p !== "DH");
  if (raw.includes("C")) slots.add("C");
  if (raw.includes("1B")) slots.add("1B");
  if (raw.includes("2B")) slots.add("2B");
  if (raw.includes("3B")) slots.add("3B");
  if (raw.includes("SS")) slots.add("SS");
  if (raw.some((p) => ["LF", "CF", "RF", "OF"].includes(p))) slots.add("OF");
  if (!hasNonDH || raw.includes("DH")) slots.add("UTIL"); // DH-only → UTIL only; multi with DH → also UTIL
  slots.add("UTIL"); // In Yahoo, every hitter is UTIL-eligible
  if (slots.size === 0) slots.add("UTIL");
  return Array.from(slots);
}

// --- Hitter scoring ---
function scoreHitter(row, headers) {
  const R = parseNum(getCol(row, headers, "R"));
  const H = parseNum(getCol(row, headers, "H"));
  const _2B = parseNum(getCol(row, headers, "2B"));
  const _3B = parseNum(getCol(row, headers, "3B"));
  const HR = parseNum(getCol(row, headers, "HR"));
  const RBI = parseNum(getCol(row, headers, "RBI"));
  const SB = parseNum(getCol(row, headers, "SB"));
  const BB = parseNum(getCol(row, headers, "BB"));
  const SO = parseNum(getCol(row, headers, "SO"));
  const AB = parseNum(getCol(row, headers, "AB"));

  const singles = H - _2B - _3B - HR;
  const PA = AB + BB;
  const hbp = Math.max(0, 0.01 * PA);
  let gidp = Math.max(0, 0.03 * (PA - SO));
  if (SB > 0) gidp *= Math.max(0.5, 1 - SB / 50);

  const pts =
    R * 1 +
    singles * 1 +
    _2B * 2 +
    _3B * 3 +
    HR * 5 +
    RBI * 1 +
    SB * 2 +
    BB * 1.5 +
    hbp * 1.5 -
    SO * 0.25 -
    gidp * 1;

  return pts;
}

// --- Pitcher role: SP if SP-eligible (or SP,RP with GS); else RP ---
function getPitcherRole(row, headers) {
  const pos = String(getCol(row, headers, "Positions") || "").toUpperCase();
  const GS = parseNum(getCol(row, headers, "GS"));
  const SV = parseNum(getCol(row, headers, "SV"));
  if (pos.includes("RP") && GS === 0) return "RP";
  if (pos.includes("RP") && SV > 0) return "RP";
  return "SP";
}

// --- Pitcher scoring (IP*1 + OUT*0.25 + K + W*5 + SV*7 + QS*5 - H - ER*2 - BB - HBP) ---
function scorePitcher(row, headers) {
  const IP = parseNum(getCol(row, headers, "IP"));
  const K = parseNum(getCol(row, headers, "K"));
  const W = parseNum(getCol(row, headers, "W"));
  const SV = parseNum(getCol(row, headers, "SV"));
  const ER = parseNum(getCol(row, headers, "ER"));
  const H = parseNum(getCol(row, headers, "H"));
  const BB = parseNum(getCol(row, headers, "BB"));
  const ERA = parseNum(getCol(row, headers, "ERA"));
  const GS = parseNum(getCol(row, headers, "GS"));

  const outs = Math.round(IP * 3);
  const qsRate = Math.max(0.2, Math.min(0.75, 1 - (ERA - 2.5) / 3.5));
  const QS = GS * qsRate;
  const battersFaced = IP * 4.25;
  const HBP = 0.01 * battersFaced;

  const pts =
    IP * 1 +
    outs * 0.25 +
    K * 1 +
    W * 5 +
    SV * 7 +
    QS * 5 -
    H * 1 -
    ER * 2 -
    BB * 1 -
    HBP * 1;

  return pts;
}

// --- Greedy fill hitter slots; return replacement weekly points per slot and slot assignment counts ---
function greedyHitterReplacement(hitters) {
  const sorted = hitters
    .slice()
    .filter((p) => p.WeeklyPoints != null)
    .sort((a, b) => (b.WeeklyPoints || 0) - (a.WeeklyPoints || 0));

  const slotCounts = { C: 12, "1B": 12, "2B": 12, "3B": 12, SS: 12, OF: 36, UTIL: 12 };
  const assigned = new Set();
  const slotLists = { C: [], "1B": [], "2B": [], "3B": [], SS: [], OF: [], UTIL: [] };

  const slotOrder = [
    ...Array(12).fill("C"),
    ...Array(12).fill("1B"),
    ...Array(12).fill("2B"),
    ...Array(12).fill("3B"),
    ...Array(12).fill("SS"),
    ...Array(36).fill("OF"),
    ...Array(12).fill("UTIL"),
  ];

  for (const slot of slotOrder) {
    for (const p of sorted) {
      if (assigned.has(p.id)) continue;
      const slots = p.EligibleSlots || getHitterEligibleSlots(p.Position);
      if (!slots.includes(slot)) continue;
      assigned.add(p.id);
      slotLists[slot].push(p);
      break;
    }
  }

  const replacement = {};
  const replacementIndex = {};
  for (const [slot, list] of Object.entries(slotLists)) {
    const n = slotCounts[slot];
    const idx = Math.min(n - 1, list.length - 1);
    replacement[slot] = idx >= 0 ? (list[idx]?.WeeklyPoints ?? 0) : 0;
    replacementIndex[slot] = list.length;
  }
  return { replacement, replacementIndex, slotLists };
}

// --- For each hitter: best eligible slot = slot with lowest replacement (max VORP) ---
function assignHitterReplacement(p, replacement) {
  const slots = p.EligibleSlots || [];
  if (slots.length === 0) {
    p.ReplacementWeeklyImpact = replacement.UTIL ?? 0;
    p.ReplacementSlot = "UTIL";
    return;
  }
  let bestSlot = slots[0];
  let bestRepl = replacement[bestSlot] ?? 1e9;
  for (const slot of slots) {
    const r = replacement[slot] ?? 1e9;
    if (r < bestRepl) {
      bestRepl = r;
      bestSlot = slot;
    }
  }
  p.ReplacementWeeklyImpact = bestRepl;
  p.ReplacementSlot = bestSlot;
}

// --- Tier assignment ---
const WINDOW_SIZE = 8;
const CLIFF_MULT_ELITE = 1.6;
const CLIFF_MULT_NORMAL = 2.25;
const CLIFF_MULT_LATE = 3.0;
const MAX_TIER_SIZE = 30;

function assignTiers(players) {
  const sorted = players
    .slice()
    .sort((a, b) => (Number(b.VORP) ?? 0) - (Number(a.VORP) ?? 0));
  const n = sorted.length;
  if (n === 0) return sorted;

  const drops = [];
  for (let i = 1; i < n; i++) {
    const prev = Number(sorted[i - 1].VORP) ?? 0;
    const curr = Number(sorted[i].VORP) ?? 0;
    drops[i] = prev - curr;
  }

  function localAvgDrop(i) {
    const start = Math.max(1, i - WINDOW_SIZE);
    const end = i - 1;
    if (end < start) return drops[i] || 0;
    let sum = 0,
      count = 0;
    for (let j = start; j <= end; j++) {
      if (drops[j] != null) {
        sum += drops[j];
        count++;
      }
    }
    return count > 0 ? sum / count : drops[i] || 0;
  }

  let tier = 1;
  let tierSize = 0;

  for (let i = 0; i < n; i++) {
    const p = sorted[i];
    const vorp = Number(p.VORP) ?? 0;
    const drop = drops[i];
    const localAvg = localAvgDrop(i);

    if (tierSize >= MAX_TIER_SIZE) {
      tier++;
      tierSize = 0;
    }

    if (i === 0) {
      p.Tier = tier;
      p.TierDropStrength = 0;
      tierSize = 1;
      continue;
    }

    let isCliff = false;
    if (localAvg > 0 && drop != null) {
      const mult =
        vorp < 2.0 ? CLIFF_MULT_LATE : i < 30 ? CLIFF_MULT_ELITE : CLIFF_MULT_NORMAL;
      if (drop >= localAvg * mult) isCliff = true;
    }

    if (isCliff) {
      tier++;
      tierSize = 1;
    } else {
      tierSize++;
    }
    p.Tier = tier;
    p.TierDropStrength =
      localAvg > 0 && drop != null ? drop / localAvg : drop != null ? 1 : 0;
  }
  return sorted;
}

// --- Main ---
function run() {
  const dataDir = path.join(__dirname, "..", "data");
  const battersPath = path.join(dataDir, "FantasyPros_2026_Projections_H.csv");
  const pitchersPath = path.join(dataDir, "FantasyPros_2026_Projections_P.csv");
  const outPath = path.join(dataDir, "rankings.csv");

  const batters = parseCSV(fs.readFileSync(battersPath, "utf8"));
  const pitchers = parseCSV(fs.readFileSync(pitchersPath, "utf8"));

  const hitters = [];
  const all = [];

  for (let i = 0; i < batters.rows.length; i++) {
    const row = batters.rows[i];
    const name = getCol(row, batters.headers, "Player");
    const team = getCol(row, batters.headers, "Team");
    const positions = getCol(row, batters.headers, "Positions");
    const SeasonPoints = scoreHitter(row, batters.headers);
    const WeeklyPoints = SeasonPoints / WEEKS_PER_SEASON;
    const EventsPerWeek = HITTER_EVENTS_PER_WEEK;
    const PointsPerEvent = SeasonPoints / (EventsPerWeek * WEEKS_PER_SEASON) || 0;
    const EligibleSlots = getHitterEligibleSlots(positions);

    const rec = {
      id: "b" + i,
      Name: name,
      Team: team,
      Position: positions,
      Role: "Hitter",
      SeasonPoints,
      WeeklyPoints,
      PointsPerEvent,
      EventsPerWeek,
      SpikeValue: 0,
      FinalWeeklyImpact: WeeklyPoints,
      EligibleSlots,
    };
    hitters.push(rec);
    all.push(rec);
  }

  const { replacement: hitterReplacement, replacementIndex: hitterReplIndex, slotLists } = greedyHitterReplacement(hitters);

  for (const p of hitters) {
    assignHitterReplacement(p, hitterReplacement);
    p.VORP = (p.WeeklyPoints ?? 0) - (p.ReplacementWeeklyImpact ?? 0);
    p.ReplacementIndex = null;
  }

  const spList = [];
  const rpList = [];

  for (let i = 0; i < pitchers.rows.length; i++) {
    const row = pitchers.rows[i];
    const name = getCol(row, pitchers.headers, "Player");
    const team = getCol(row, pitchers.headers, "Team");
    const positions = getCol(row, pitchers.headers, "Positions");
    const role = getPitcherRole(row, pitchers.headers);
    const SeasonPoints = scorePitcher(row, pitchers.headers);
    const evPerWeek = role === "SP" ? SP_EVENTS_PER_WEEK : RP_EVENTS_PER_WEEK;
    const WeeklyPoints = SeasonPoints / WEEKS_PER_SEASON;
    const PointsPerEvent = SeasonPoints / (evPerWeek * WEEKS_PER_SEASON) || 0;

    const rec = {
      id: "p" + i,
      Name: name,
      Team: team,
      Position: positions,
      Role: role,
      SeasonPoints,
      WeeklyPoints,
      PointsPerEvent,
      EventsPerWeek: evPerWeek,
      SpikeValue: role === "RP" ? 0.29 : 5.0,
      FinalWeeklyImpact: WeeklyPoints,
      EligibleSlots: [role],
      ReplacementSlot: role,
    };
    if (role === "SP") spList.push(rec);
    else rpList.push(rec);
    all.push(rec);
  }

  const spSorted = spList.slice().sort((a, b) => (b.WeeklyPoints ?? 0) - (a.WeeklyPoints ?? 0));
  const rpSorted = rpList.slice().sort((a, b) => (b.WeeklyPoints ?? 0) - (a.WeeklyPoints ?? 0));
  const spN = SLOT_COUNTS.SP;
  const rpN = SLOT_COUNTS.RP;
  const replSP = spSorted[Math.min(spN - 1, spSorted.length - 1)]?.WeeklyPoints ?? 0;
  const replRP = rpSorted[Math.min(rpN - 1, rpSorted.length - 1)]?.WeeklyPoints ?? 0;

  for (const p of spList) {
    p.ReplacementWeeklyImpact = replSP;
    p.VORP = (p.WeeklyPoints ?? 0) - replSP;
    p.ReplacementIndex = spN;
  }
  for (const p of rpList) {
    p.ReplacementWeeklyImpact = replRP;
    p.VORP = (p.WeeklyPoints ?? 0) - replRP;
    p.ReplacementIndex = rpN;
  }

  const sorted = all
    .slice()
    .sort((a, b) => (b.VORP ?? 0) - (a.VORP ?? 0));

  assignTiers(sorted);

  // Sanity check
  console.log("--- Replacement level (weekly points) ---");
  console.log("C:", hitterReplacement.C?.toFixed(2), "| 1B:", hitterReplacement["1B"]?.toFixed(2), "| 2B:", hitterReplacement["2B"]?.toFixed(2), "| 3B:", hitterReplacement["3B"]?.toFixed(2), "| SS:", hitterReplacement.SS?.toFixed(2), "| OF:", hitterReplacement.OF?.toFixed(2), "| UTIL:", hitterReplacement.UTIL?.toFixed(2));
  console.log("SP:", replSP.toFixed(2), "| RP:", replRP.toFixed(2));
  console.log("--- Pool sizes ---");
  console.log("C:", slotLists.C.length, "| 1B:", slotLists["1B"].length, "| 2B:", slotLists["2B"].length, "| 3B:", slotLists["3B"].length, "| SS:", slotLists.SS.length, "| OF:", slotLists.OF.length, "| UTIL:", slotLists.UTIL.length);
  console.log("SP:", spList.length, "| RP:", rpList.length);
  console.log("Total players:", sorted.length);

  const headers = [
    "Rank",
    "Name",
    "Team",
    "Position",
    "Role",
    "SeasonPoints",
    "WeeklyPoints",
    "ReplacementWeeklyImpact",
    "VORP",
    "Tier",
    "TierDropStrength",
    "ReplacementSlot",
    "EligibleSlots",
    "ReplacementIndex",
    "PointsPerEvent",
    "EventsPerWeek",
    "SpikeValue",
    "FinalWeeklyImpact",
  ];

  const out = [
    headers.map(escapeCSVCell).join(","),
    ...sorted.map((p, i) =>
      [
        i + 1,
        p.Name,
        p.Team,
        p.Position,
        p.Role,
        (p.SeasonPoints ?? 0).toFixed(2),
        (p.WeeklyPoints ?? 0).toFixed(2),
        (p.ReplacementWeeklyImpact ?? 0).toFixed(2),
        (p.VORP ?? 0).toFixed(2),
        p.Tier ?? 1,
        (p.TierDropStrength != null ? p.TierDropStrength : 0).toFixed(3),
        p.ReplacementSlot ?? "",
        (Array.isArray(p.EligibleSlots) ? p.EligibleSlots.join(",") : p.EligibleSlots ?? ""),
        p.ReplacementIndex ?? "",
        (p.PointsPerEvent ?? 0).toFixed(2),
        p.EventsPerWeek ?? "",
        (p.SpikeValue ?? 0).toFixed(2),
        (p.FinalWeeklyImpact ?? 0).toFixed(2),
      ].map(escapeCSVCell).join(",")
    ),
  ];

  fs.writeFileSync(outPath, out.join("\n") + "\n", "utf8");
  console.log("Wrote", sorted.length, "players to", outPath);
}

if (require.main === module) {
  run();
}

module.exports = { run, scoreHitter, scorePitcher, assignTiers, getHitterEligibleSlots };
