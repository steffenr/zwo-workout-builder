# AGENTS.md

Guidance for coding agents working on the Zwo Workout Builder. Read `README.md` for what the
project does and `DESIGN.md` before touching the UI.

## Setup and commands

```sh
npm install          # esbuild only
npm run index        # rebuild data/ from the library in the parent folder (see below)
npm test             # must end with "problems: 0" (exits non-zero otherwise)
npm run build        # dist/zwo-workout-builder.html
npm run review       # dist/library-index.html
```

- Node 18+ locally; CI and the release pipeline run Node 24 with a clean `npm ci`.
- ES modules everywhere (`"type": "module"`).
- No runtime dependencies. Do not add packages to `src/`; the app must stay a single offline
  HTML file. esbuild is the only dev dependency.
- esbuild has a native binary: run `npm install` on the machine that builds (a
  `node_modules` from macOS won't work in a Linux shell and vice versa).

## The workout library and `data/`

- The `.zwo` library is not part of the source tree. `data/*.json` (generated from it) and
  `library-snapshot.tar.gz` (the library's `.zwo` files, one sub-folder per plan or
  collection, files named `WeekNN_DayNN_<Name>.zwo`) are committed.
- `npm run index` reads the parent folder (`..`), so it only works when the repo sits inside
  the library folder. Otherwise extract the snapshot and pass its path:
  ```sh
  mkdir -p /tmp/zwo-library && tar xzf library-snapshot.tar.gz -C /tmp/zwo-library
  node scripts/build-index.mjs /tmp/zwo-library data && node scripts/derive-rules.mjs data
  ```
- Folders starting with `_` or `.` are skipped by the indexer.
- Never modify, move or delete library files or the snapshot. Regenerate `data/` only when
  the library or `src/core` (parsing, metrics, classification) changes, and commit the result.

## Architecture in one paragraph

`src/core` parses `.zwo` and computes metrics/classification; it is shared by the Node
scripts and the browser app. `scripts/build-index.mjs` turns the library into `data/*.json`;
`scripts/derive-rules.mjs` learns plan rules into `data/rules.json`. `src/engine` builds
plans and workouts from wizard input plus `library.json` and `rules.json`
(`buildPlan`, `buildSingle`, `rerollSession`, `planFiles` in `plan.js`; `makeWorkout` in
`workout.js`). Output writers: `export.js` (`.zwo` XML and the ZIP writer) and `ictx.js`
(icTrainer `.ictx`). `src/app/main.js` is the wizard UI (vanilla JS, string templates, one
`render()`). `scripts/build-app.mjs` bundles it with esbuild into
`dist/zwo-workout-builder.html`: the engine data goes in as gzip + base64 (decompressed in
the browser with `DecompressionStream`), and `src/app/icon.svg` is inlined in the top bar
and as the favicon.

## Rules that must hold

1. **No library text in output.** Titles, descriptions, plan names and author texts of
   library workouts must never appear in generated names, descriptions, file names, the UI
   or the app bundle. Library workouts may only be used for their power structure and
   metrics. `build-app.mjs` keeps only `id, primary, secondary, level, flags, workMin,
   durMin, blocks` per workout (and drops `rules.typeTransitions`). Series names in
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
6. **Downloads.** Single workouts save as one `.zwo` or one `.ictx`. Plans and "download
   all" save as `.zip` (writer in `export.js`); a plan ZIP holds one `.zwo` and one `.ictx`
   per indoor session plus `plan-overview.md`. Inside claude.ai only allow-listed extensions
   can be saved, so `downloadWorkout` and the `.ictx` download try the file first and fall
   back to a `.zip` on `rejected_extension` / `extension_not_enabled`; keep that fallback.
7. **Plain browser APIs.** No `alert/confirm/prompt`, wrap every `localStorage` access in
   try/catch (keys `zwo-builder-answers`, `zwo-builder-theme`).

## Working on the engine

- Training logic lives in data tables at the top of `plan.js` (`GOALS`, `STYLES`,
  `RIDER_TYPES`, `WEAKNESSES`) and `compose.js` (`CATEGORY_INFO`, format generators,
  `RAMP_TEST`). Prefer changing tables over adding branches.
- Work doses come from `rules.workDoseMin` (library medians); `workDose()` interpolates
  between duration anchors. Don't hard-code minutes of work.
- New interval format: add a generator in `compose.js` returning
  `{ format, label, blocks, workSec }` candidates; the selector picks the one closest to the
  dose that fits the budget. The label is shown to users ("Threshold 4x8min"), keep it short.
- The FTP ramp test is built by `rampTest()` in `compose.js`, never taken from the library
  (the library's test files are placeholders). Sprints are `<MaxEffort>` blocks.
- Library main sets are only used when `structureFits()` in `library.js` accepts them.
- After any engine change run `npm test`. Expect `problems: 0` and classifier agreement of
  about 98 % or better (currently 205/207); look at the printed weeks, not only the summary
  line. Engine changes that touch `.ictx` output are checked by `checkIctx` in
  `scripts/test-engine.mjs`.

## Working on the UI

- Follow `DESIGN.md`. The app uses zwoTrainer's design system (`../zwoTrainer/DESIGN.md`,
  `ui/css/styles.css`): same tokens, fonts, five zone colours and component classes. When
  zwoTrainer changes a token or a shared component, mirror it here.
- Tokens only (no literal colours in components), both themes, zone colours only for
  training intensity, the accent only for actions, selection and progress.
- Don't add controls to the top bar (app icon + brand left, Settings right). New options go
  into the Settings popover. The app icon is `src/app/icon.svg`; change it there only.
- Rebuild with `npm run build` and open the file at 1280 px and 390 px in light and dark
  mode. The page body must never scroll horizontally; controls must stay inside their
  tiles and cards at 390 px.
- Copy: short, plain English, active voice, no mention of the library.

## Releases and deployment

- Releases are cut only through Actions → "Prepare release" (run on `develop`, choose
  patch / minor / major). It runs the CI gate, bumps `package.json` / `package-lock.json`,
  commits `chore(release): X.Y.Z` as `github-actions[bot]`, tags `vX.Y.Z` and runs
  `release.yml` (build → GitHub Release → GitHub Pages). Don't bump versions or push tags by
  hand. Pull `develop` after a release before pushing new commits.
- GitHub Pages is deployed only by the release pipeline (or a manual run of
  `deploy-pages.yml`), so it always shows the latest release, not the tip of `develop`. Only
  the built app goes to Pages, never `data/`, the snapshot or the library review page.
- `ci.yml` runs `npm test` and `npm run build` on pushes and pull requests to `develop`
  (Markdown-only changes are skipped). Both must pass on Linux with a clean `npm ci`.

## Commits

- Work on `develop`. Conventional Commit subjects (`feat(ui): …`, `fix(plan): …`,
  `test(engine): …`, `ci: …`, `docs: …`), body explaining why.
- Author commits as `SteffenR <github@port11.de>`; no AI co-author or session trailers.

## Before finishing a change

- [ ] `npm test` → `problems: 0`
- [ ] `npm run build` succeeds; app opens without console errors
- [ ] No library text in the bundle. The data is compressed, so grepping the HTML proves
      nothing; decode it instead (expect `extra keys: none` and `false`):
      ```sh
      node -e 'const h=require("fs").readFileSync("dist/zwo-workout-builder.html","utf8");const j=require("zlib").gunzipSync(Buffer.from(h.match(/id="engine-data">([^<]*)</)[1],"base64")).toString();const k=new Set(JSON.parse(j).library.flatMap(Object.keys));const ok="id primary secondary level flags workMin durMin blocks".split(" ");console.log("extra keys:",[...k].filter(x=>!ok.includes(x)).join(",")||"none",/"(title|planTag)"/.test(j))'
      ```
- [ ] README / DESIGN updated if behaviour or design changed
