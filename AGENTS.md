# AGENTS.md

Guidance for coding agents working on the Zwo Workout Builder. Read `README.md` for what the
project does and `DESIGN.md` before touching the UI.

## Setup and commands

```sh
npm install          # esbuild only
npm run index        # rebuild data/ from the library in the parent folder
npm test             # must end with "problems: 0"
npm run build        # dist/zwo-workout-builder.html
npm run review       # dist/library-index.html
```

- Node 18+, ES modules everywhere (`"type": "module"`).
- No runtime dependencies. Do not add packages to `src/`; the app must stay a single offline
  HTML file. esbuild is the only dev dependency.
- The workout library is the parent folder (`..`), one sub-folder per plan or collection,
  files named `WeekNN_DayNN_<Name>.zwo`. Never modify, move or delete library files.
  Folders starting with `_` or `.` are skipped by the indexer.

## Architecture in one paragraph

`src/core` parses `.zwo` and computes metrics/classification; it is shared by the Node
scripts and the browser app. `scripts/build-index.mjs` turns the library into `data/*.json`;
`scripts/derive-rules.mjs` learns plan rules into `data/rules.json`. `src/engine` builds
plans and workouts from wizard input plus `library.json` and `rules.json`
(`buildPlan`, `buildSingle`, `rerollSession` in `plan.js`; `makeWorkout` in `workout.js`).
`src/app/main.js` is the wizard UI (vanilla JS, string templates, one `render()`), and
`scripts/build-app.mjs` bundles it with the data into `dist/zwo-workout-builder.html`.

## Rules that must hold

1. **No library text in output.** Titles, descriptions, plan names and author texts of
   library workouts must never appear in generated names, descriptions, file names, the UI
   or the app bundle. Library workouts may only be used for their power structure and
   metrics. `build-app.mjs` strips everything except `primary, secondary, level, flags,
   workMin, durMin, blocks`. Series names in
   `naming.js` must not match any library title; check after editing `SERIES`:
   ```sh
   node -e 'const t=require("./data/library.json").map(w=>w.title.toLowerCase());import("./src/engine/naming.js").then(({SERIES})=>{for(const l of Object.values(SERIES))for(const n of l)if(t.some(x=>x.includes(n.toLowerCase())))console.log("clash",n)})'
   ```
2. **Deterministic.** Same wizard answers → same plan. Use the seeded RNG from `rng.js`
   (`makeRng`, `fork`), never `Math.random()` in the engine. Per-session RNGs are keyed by
   seed, week and day so regenerating one session doesn't change the others.
3. **Two-decimal power.** Zwift stores power as fractions of FTP with two decimals. Block
   constructors in `blocks.js` round to 0.01 so metrics are identical after export; build
   blocks only through those constructors.
4. **Durations in whole seconds**, slot lengths in 5-minute steps. A generated workout must
   last its slot length (±2 min); `npm test` checks this.
5. **Engine is pure.** No DOM, storage or network in `src/core` or `src/engine`; they run in
   Node and the browser.
6. **Downloads.** Single workouts save as one `.zwo`. Plans and "download all" save as `.zip`
   (writer in `export.js`). Inside claude.ai only allow-listed extensions can be saved, so
   `downloadWorkout` tries `.zwo` first and falls back to a `.zip` on `rejected_extension`;
   keep that fallback.
7. **Plain browser APIs.** No `alert/confirm/prompt`, wrap every `localStorage` access in
   try/catch.

## Working on the engine

- Training logic lives in data tables at the top of `plan.js` (`GOALS`, `STYLES`,
  `RIDER_TYPES`, `WEAKNESSES`) and `compose.js` (`CATEGORY_INFO`, format generators). Prefer
  changing tables over adding branches.
- Work doses come from `rules.workDoseMin` (library medians); `workDose()` interpolates
  between duration anchors. Don't hard-code minutes of work.
- New interval format: add a generator in `compose.js` returning
  `{ format, label, blocks, workSec }` candidates; the selector picks the one closest to the
  dose that fits the budget. The label is shown to users ("Threshold 4x8min"), keep it short.
- After any engine change run `npm test`. Expect `problems: 0` and classifier agreement of
  at least 175/180; look at the printed weeks, not only the summary line.

## Working on the UI

- Follow `DESIGN.md`. The app uses zwoTrainer's design system (`../zwoTrainer/DESIGN.md`,
  `ui/css/styles.css`): same tokens, fonts, five zone colours and component classes. When
  zwoTrainer changes a token or a shared component, mirror it here.
- Tokens only (no literal colours in components), both themes, zone colours only for
  training intensity, the accent only for actions, selection and progress.
- Don't add controls to the top bar (logo left, Settings right). New options go into the
  Settings popover.
- Rebuild with `npm run build` and open the file at 1280 px and 390 px in light and dark
  mode. The page body must never scroll horizontally.
- esbuild has a native binary: run `npm install` on the machine that builds (a
  `node_modules` from macOS won't work in a Linux shell and vice versa).
- Copy: short, plain English, active voice, no mention of the library.

## Releases and deployment

- Releases are cut only through Actions → "Prepare release" (bumps `package.json`, tags
  `vX.Y.Z`); `release.yml` then publishes the GitHub Release. Don't bump versions or push
  tags by hand.
- `deploy-pages.yml` deploys every push to `develop`; only the built app goes to Pages, never
  `data/` or the library review page.
- Workflows run `npm test` and `npm run build`; both must pass on Linux with a clean
  `npm ci`.

## Before finishing a change

- [ ] `npm test` → `problems: 0`
- [ ] `npm run build` succeeds; app opens without console errors
- [ ] No library titles in `dist/zwo-workout-builder.html`
      (`grep -c "planTag\|\"title\"" dist/zwo-workout-builder.html` → 0)
- [ ] README / DESIGN updated if behaviour or design changed
