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
│   ├── batters.csv       # Source data (if you regenerate rankings)
│   └── pitchers.csv
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

## Generate rankings (custom scoring)

Build `rankings.csv` from `batters.csv` and `pitchers.csv` using your league scoring rules:

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

This rewrites `data/rankings.csv` in place with updated tier columns. For a full rebuild from `batters.csv` and `pitchers.csv`, use `npm run generate` instead.

## Tech

- **Backend:** Node.js, plain `http` and `fs` (no framework)
- **Frontend:** Vanilla JS, no build step; state in `localStorage`
- **Data:** CSV only; `rankings.csv` includes Rank, Name, Team, Position, Role, SeasonPoints, WeeklyPoints, ReplacementWeeklyImpact, VORP, Tier, TierDropStrength, plus optional columns (ReplacementSlot, EligibleSlots, etc.)

## License

MIT
