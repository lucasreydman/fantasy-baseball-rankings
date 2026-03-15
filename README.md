# Points League Draft Board

A fantasy baseball draft board and roster tracker for points leagues. Uses VORP-based rankings with value-cliff tiers to help you draft by best available value. Tuned for a **12-team head-to-head points** league with roster: C, 1B, 2B, 3B, SS, OF×3, UTIL, SP×5, RP×1, Bench×5.

## Features

- **Draft board** — Sort by VORP or Weekly impact; filter by position (SP, Hitters, RP, C, OF, etc.) or “Needed” (unfilled slots only). Displays the **top 300** players from the full rankings for performance.
- **Tier system** — Tiers are based on relative VORP drops (value cliffs), not fixed counts
- **Roster tracker** — Slot counts (C, 1B, 2B, 3B, SS, OF×3, UTIL, SP×5, RP×1, Bench×5) and full roster list
- **Draft context** — Picks made, SP/RP/hitters drafted at a glance
- **Alerts** — Gentle reminders (e.g. &lt; 5 SP by round 12, RP empty after round 14)
- **Persistence** — Draft state (your picks, others’ picks, undo history) saved in `localStorage`

## Project structure

```
baseball-rankings/
├── data/                 # CSV data
│   ├── rankings.csv      # Main board (VORP, tiers; served at /data)
│   ├── FantasyPros_2026_Projections_H.csv   # Hitter projections (source data)
│   └── FantasyPros_2026_Projections_P.csv   # Pitcher projections (source data)
├── public/               # Static frontend
│   ├── index.html
│   ├── app.js            # Draft logic, UI, filters, persistence
│   └── style.css
├── scripts/
│   ├── generate-rankings.js  # Build rankings.csv from batters + pitchers (custom scoring)
│   └── rankings.js       # Tier assignment (value-cliff algorithm)
├── server.js             # HTTP server: static files + /data → rankings.csv
├── package.json
└── README.md
```

## Run the app

```bash
npm start
```

Then open **http://localhost:3000**. The board loads rankings from `/data` (served from `data/rankings.csv`) and shows the top 300 by rank.

## How rankings are customized for this league

Everything in `scripts/generate-rankings.js` is tuned to the specific rules and roster structure of this 12-team head-to-head points league. Here's exactly what changes relative to a generic rankings source.

### 1. Custom point values

Raw FantasyPros projections (R, H, 2B, 3B, HR, RBI, SB, BB, SO, IP, K, W, SV, ER, etc.) are fed into scoring formulas that match this league's ruleset — **not** standard ESPN/Yahoo defaults.

**Hitters** (`scoreHitter`):

| Stat | Points |
|------|--------|
| Run (R) | +1 |
| Single (1B) | +1 |
| Double (2B) | +2 |
| Triple (3B) | +3 |
| Home Run (HR) | +5 |
| RBI | +1 |
| Stolen Base (SB) | +2 |
| Walk (BB) | +1.5 |
| Hit By Pitch (HBP) | +1.5 |
| Strikeout (SO) | −0.25 |
| GIDP | −1 |

Singles are derived as `H − 2B − 3B − HR`. HBP and GIDP are estimated from PA since they're absent from the projection CSV (`HBP = PA × 0.01`, `GIDP = PA × 0.03`, reduced for speedsters with SB).

**Pitchers** (`scorePitcher`):

| Stat | Points |
|------|--------|
| Inning Pitched (IP) | +1 |
| Out Recorded (each out) | +0.25 |
| Strikeout (K) | +1 |
| Win (W) | +5 |
| Save (SV) | +7 |
| Quality Start (QS) | +5 |
| Hit Allowed (H) | −1 |
| Earned Run (ER) | −2 |
| Walk (BB) | −1 |
| Hit By Pitch (HBP) | −1 |

QS is not in the projection CSV and is estimated as `GS × clamp(1 − (ERA − 2.5) / 3.5, 0.2, 0.75)`. HBP is estimated as `BF × 0.01` where `BF ≈ IP × 4.25`.

---

### 2. Replacement level calibrated to this exact roster

VORP (Value Over Replacement Player) is what drives the rankings. Replacement level is the weekly points of the last rostered starter at each position, based on **this league's roster slots** across all 12 teams:

| Slot | Starters (12 teams) |
|------|---------------------|
| C | 12 |
| 1B | 12 |
| 2B | 12 |
| 3B | 12 |
| SS | 12 |
| OF | 36 (3 per team) |
| UTIL | 12 |
| SP | 60 (5 per team) |
| RP | 12 (1 per team) |

The bench (5 spots) is intentionally **excluded** from replacement level — bench players don't contribute to weekly scoring so they don't set the bar.

For hitters, a **greedy slot-fill algorithm** runs through all projected hitters sorted by weekly points, filling C → 1B → 2B → 3B → SS → OF → UTIL in order without reusing the same player. This correctly handles multi-position eligibility: a player eligible at SS and 2B will be assigned once to the slot that maximizes their VORP (i.e., the position with the lower replacement bar). Each hitter's VORP is then `WeeklyPoints − ReplacementWeeklyImpact` using their best eligible slot.

Pitchers are simpler: replacement SP = 60th-best SP's weekly points; replacement RP = 12th-best RP's weekly points. SP/RP classification uses role + GS/SV logic from the projection file.

---

### 3. VORP-based ordering (not ADP, not category ranks)

The final ranking is sorted purely by `VORP = WeeklyPoints − ReplacementWeeklyImpact`. This means:

- A scarce position player (C, SS) ranks higher than a 1B with identical raw production, because the replacement bar is lower at scarce spots — your upside over a waiver-wire replacement is larger.
- A mediocre closer can rank above a solid SP if saves are scarce enough (RP replacement is set by just 12 starters league-wide vs. 60 for SP).
- Late-round hitters with UTIL eligibility get compared to the UTIL replacement bar, not the C or SS bar, correctly deflating their relative value.

---

### 4. Value-cliff tier system

Tiers are not fixed round buckets — they're computed dynamically in `scripts/rankings.js` using a sliding-window algorithm:

- At each rank, the VORP drop to the next player is compared to the **local average drop** over the prior 8 players.
- A new tier starts when the drop exceeds the local average by a multiplier: **1.6× for the top 30** (elite players), **2.25× for mid-rounds**, **3.0× for late rounds** (where VORP is near zero and tiny drops are noise).
- No tier can exceed 30 players, forcing a break even without a visible cliff.

This means tier boundaries shift based on the actual shape of the value curve in your scoring system, not a generic preset. A run of similarly valued SPs will stay in one tier; a big gap after a top closer correctly breaks a new tier.

---

### 5. What to change if your league rules change

All tunable values live at the top of `scripts/generate-rankings.js`:

- **Scoring weights** → edit `scoreHitter()` or `scorePitcher()`
- **Team count** → change `SLOT_COUNTS` (all values scale with teams × slots per team)
- **Roster slots** (e.g., add CI/MI, change SP count) → update `SLOT_COUNTS` and `HITTER_SLOT_ORDER`
- **Season length** → change `WEEKS_PER_SEASON` (affects weekly point normalization)

After any change, run `npm run generate` to rebuild `rankings.csv` from scratch.

---

## Generate rankings (custom scoring)

Build `rankings.csv` from `FantasyPros_2026_Projections_H.csv` and `FantasyPros_2026_Projections_P.csv` using your league scoring rules:

```bash
npm run generate
```

This produces a **full** combined rankings file (all players, sorted by VORP) with tiers and draft-ready columns. Everything is defined in `scripts/generate-rankings.js`:

- **Scoring** — Hitter and pitcher point formulas (R, HR, SB, IP, K, SV, QS, etc.); missing stats (HBP, GIDP, QS) are estimated.
- **Replacement level** — Slot-accurate for a 12-team league: C(12), 1B(12), 2B(12), 3B(12), SS(12), OF(36), UTIL(12), SP(60), RP(12). Bench is not used for replacement. Hitters use a greedy slot assignment so multi-eligibility is respected.
- **Output** — All players ranked by VORP; tiers assigned via value-cliff algorithm. The draft board then shows only the **top 300** for a faster UI.

## Regenerate tiers only

If you edit `data/rankings.csv` by hand and only want to recompute Tier and TierDropStrength (without re-running the full generator):

```bash
npm run tiers
```

This rewrites `data/rankings.csv` in place with updated tier columns. For a full rebuild from the FantasyPros projection files, use `npm run generate` instead.

## Tech

- **Backend:** Node.js, plain `http` and `fs` (no framework)
- **Frontend:** Vanilla JS, no build step; state in `localStorage`
- **Data:** CSV only; `rankings.csv` includes Rank, Name, Team, Position, Role, SeasonPoints, WeeklyPoints, ReplacementWeeklyImpact, VORP, Tier, TierDropStrength, plus optional columns (ReplacementSlot, EligibleSlots, etc.)

## License

MIT
