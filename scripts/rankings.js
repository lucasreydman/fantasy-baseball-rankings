const fs = require("fs");
const path = require("path");

var WINDOW_SIZE = 8;
var CLIFF_MULT_ELITE = 1.6;
var CLIFF_MULT_NORMAL = 2.25;
var CLIFF_MULT_LATE = 3.0;
var MAX_TIER_SIZE = 30;

function assignTiers(players) {
  var sorted = players.slice().sort(function (a, b) { return (Number(b.VORP) || 0) - (Number(a.VORP) || 0); });
  var n = sorted.length;
  if (n === 0) return sorted;

  var drops = [];
  for (var i = 1; i < n; i++) {
    var prev = Number(sorted[i - 1].VORP) || 0;
    var curr = Number(sorted[i].VORP) || 0;
    drops[i] = prev - curr;
  }

  function localAvgDrop(i) {
    var start = Math.max(1, i - WINDOW_SIZE);
    var end = i - 1;
    if (end < start) return drops[i] || 0;
    var sum = 0;
    var count = 0;
    for (var j = start; j <= end; j++) {
      if (drops[j] != null) { sum += drops[j]; count++; }
    }
    return count > 0 ? sum / count : (drops[i] || 0);
  }

  var tier = 1;
  var tierSize = 0;

  for (var i = 0; i < n; i++) {
    var p = sorted[i];
    var vorp = Number(p.VORP) || 0;
    var drop = drops[i];
    var localAvg = localAvgDrop(i);

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

    var isCliff = false;
    if (localAvg > 0 && drop != null) {
      var mult = vorp < 2.0 ? CLIFF_MULT_LATE : (i < 30 ? CLIFF_MULT_ELITE : CLIFF_MULT_NORMAL);
      if (drop >= localAvg * mult) isCliff = true;
    }

    if (isCliff) {
      tier++;
      tierSize = 1;
    } else {
      tierSize++;
    }
    p.Tier = tier;
    p.TierDropStrength = localAvg > 0 && drop != null ? (drop / localAvg) : (drop != null ? 1 : 0);
  }
  return sorted;
}

function parseCSVLine(line) {
  var row = [];
  var i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      var cell = "";
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
      var cell = "";
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

function run() {
  const csvPath = path.join(__dirname, "..", "data", "rankings.csv");
  const text = fs.readFileSync(csvPath, "utf8");
  const lines = text.split(/\r?\n/).filter(function (l) { return l.length > 0; });
  if (lines.length < 2) return;
  const headers = parseCSVLine(lines[0]);
  const vorpIdx = headers.indexOf("VORP");
  const tierIdx = headers.indexOf("Tier");
  if (vorpIdx === -1 || tierIdx === -1) return;

  const rows = [];
  const players = [];
  for (var i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    rows.push(row);
    const vorp = parseFloat(row[vorpIdx]);
    const rec = { rowIndex: i - 1, VORP: isNaN(vorp) ? 0 : vorp };
    players.push(rec);
  }

  assignTiers(players);

  var byRow = {};
  players.forEach(function (p) { byRow[p.rowIndex] = p; });

  var outHeaders = headers.indexOf("TierDropStrength") === -1 ? headers.concat(["TierDropStrength"]) : headers;
  var tierDropIdx = outHeaders.indexOf("TierDropStrength");

  var out = [outHeaders.map(escapeCSVCell).join(",")];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r].slice();
    var pl = byRow[r];
    row[tierIdx] = pl ? String(pl.Tier) : row[tierIdx];
    if (tierDropIdx >= row.length) {
      row.push(pl && pl.TierDropStrength != null ? Number(pl.TierDropStrength).toFixed(3) : "");
    } else {
      row[tierDropIdx] = pl && pl.TierDropStrength != null ? Number(pl.TierDropStrength).toFixed(3) : "";
    }
    out.push(row.map(escapeCSVCell).join(","));
  }
  fs.writeFileSync(csvPath, out.join("\n") + "\n", "utf8");
}

if (require.main === module) {
  run();
}
