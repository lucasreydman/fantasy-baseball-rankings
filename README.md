# Points League Draft Board

A fantasy baseball draft board and roster tracker for points leagues. Uses VORP-based rankings with value-cliff tiers to help you draft by best available value.

## Features

- **Draft board** — Sort by VORP or Weekly impact; filter by position (SP, Hitters, RP, C, OF, etc.) or “Needed” (unfilled slots only)
- **Tier system** — Tiers are based on relative VORP drops (value cliffs), not fixed counts
- **Roster tracker** — Slot counts (C, 1B, 2B, … SP, RP, Bench) and full roster list
- **Draft context** — Picks made, SP/RP/hitters drafted at a glance
- **Alerts** — Gentle reminders (e.g. &lt; 4 SP by round 12, RP empty after round 14)
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
│   └── rankings.js       # Tier assignment (value-cliff algorithm)
├── server.js             # HTTP server: static files + /data → rankings.csv
├── package.json
└── README.md
```

## Run the app

```bash
npm start
```

Then open **http://localhost:3000**. The board loads rankings from `/data` (served from `data/rankings.csv`).

## Regenerate tiers

After editing `data/rankings.csv` or changing the tier algorithm in `scripts/rankings.js`:

```bash
npm run tiers
```

This rewrites `data/rankings.csv` with updated `Tier` and `TierDropStrength` columns. Restart or refresh the app to see changes.

## Tech

- **Backend:** Node.js, plain `http` and `fs` (no framework)
- **Frontend:** Vanilla JS, no build step; state in `localStorage`
- **Data:** CSV only; rankings include VORP, tiers, and tier-drop strength

## License

MIT
