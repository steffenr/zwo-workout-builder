<h1 align="center">
<img width="350" alt="zwo-workout-builder-logo-with-text" src="https://github.com/user-attachments/assets/64a7a2cd-90ab-48cb-9648-31d395704427" />  
</h1>

# zwoWorkoutBuilder

A guided wizard that builds Zwift training plans and single workouts (`.zwo`), fully offline.

It learns from a library of existing `.zwo` workouts: every workout is parsed and classified
by its power profile, and plan rules (load progression, recovery weeks, work doses) are derived
from the multi-week plans. The wizard then builds plans and workouts that fit the rider's
FTP, training status, goal, weekly schedule and preferred style.

No AI service, no server, no account: the app is one HTML file.

## Using the app

Use the hosted copy on GitHub Pages (<https://steffenr.github.io/zwo-workout-builder/>, always
the latest release), download `zwo-workout-builder.html` from a GitHub Release, or build it
yourself and open **`dist/zwo-workout-builder.html`** in a browser.

1. **Mode** — training plan or single workout
2. **Rider** — FTP, weight, hours per week over the last 4–6 weeks, structured-training experience
3. **Goal** (plan) — goal, plan length (4–16 weeks, or until an event date: 4–24 weeks
   ending with a taper week), optional FTP ramp test
   **Workout** (single) — training type or "Pick for me", length (30 min – 3 h)
4. **Week** (plan) — riding days, time per day (30 min – 5 h in 15-minute steps), outdoor
   rides (counted for load, no file)
5. **Style** — training style (pyramidal / polarized / sweet spot / auto), intensity,
   rider type, weak spots, cadence drills
6. **Result**
   - Plan: stats, weekly load chart, one list of workouts per week. Selecting a workout opens
     its details (power profile in watts, segment targets on hover, time in zone) with
     "Swap for another", **Download .ictx** and **Download .zwo**; **Download plan (.zip)**
     at the top
   - Single: three option cards, each with **Download .zwo** and **Download .ictx**, or all
     as a .zip

**icTrainer export.** Every workout also generates a `.ictx` file (icTrainer's XML format):
the plan ZIP contains one `.zwo` *and* one `.ictx` per indoor session, and single workouts
can be downloaded directly as `.ictx`.

Plan ZIP layout:

```
<plan-slug>/
  Week01_Day02_Red_Line_#1_Threshold_4x5min.zwo   # Day = weekday, 1 = Monday
  Week01_Day02_Red_Line_#1_Threshold_4x5min.ictx  # same session for icTrainer
  Week01_Day07_Base_Miles_Endurance_120min.zwo
  …
  plan-overview.md
```

Copy the `.zwo` files into Zwift's `Documents/Zwift/Workouts/<user id>/`, or import the
`.ictx` files into icTrainer. Power targets are % of FTP, so the files work for any FTP.

Clicking the logo returns to the mode selection; answers and the last result are kept.
The colour theme (Match system / Light / Dark) is in Settings (gear icon, top right); the
icon next to it opens this repository on GitHub.
Answers and the theme are stored in the browser's local storage only.

The design follows zwoTrainer's design system, see `DESIGN.md`.

**Inside claude.ai** the published copy of the app can only save `.zip` files; single
`.zwo` / `.ictx` workouts then come inside a `.zip`. The local HTML file saves them directly.

## Project layout

```
zwoWorkoutBuilder/
├── .github/                 CI, release and Pages workflows, Dependabot
├── src/
│   ├── core/                parsing, metrics, classification (shared by scripts and app)
│   │   ├── zwo.js           .zwo parser, 1-s power timeline, NP / IF / TSS, zones, efforts
│   │   └── classify.js      type label, level, flags, structure text, interval patterns
│   ├── engine/              plan and workout generation (pure ES modules, no dependencies)
│   │   ├── plan.js          athlete model, goals/styles/weak spots, periodization, week layout, re-roll, single options
│   │   ├── workout.js       entry point: library-based or composed workout + metrics
│   │   ├── compose.js       interval formats, work-dose sizing, warm-up/cool-down, category texts
│   │   ├── library.js       picks a library structure and fits it to the slot; own set labels
│   │   ├── naming.js        series names, file names, descriptions
│   │   ├── export.js        .zwo XML writer, ZIP writer (store, no compression)
│   │   ├── ictx.js          .ictx (icTrainer) XML writer, port of the WoZ converter
│   │   ├── blocks.js        block constructors, compact encoding
│   │   └── rng.js           seeded PRNG + hash (same answers → same plan)
│   ├── app/                 wizard UI: main.js, template.html (tokens + CSS), icon.svg (app icon / favicon)
│   └── browser/             template of the library review page
├── scripts/
│   ├── build-index.mjs      library → data/*.json
│   ├── derive-rules.mjs     plans → data/rules.json
│   ├── check-labels.mjs     labels vs. coach-given titles (quality check)
│   ├── test-engine.mjs      sample athletes → plans, checks
│   ├── build-browser.mjs    dist/library-index.html
│   └── build-app.mjs        dist/zwo-workout-builder.html (esbuild bundle + data)
├── data/                    generated knowledge base (see below), committed
├── dist/                    generated pages (not committed)
├── library-snapshot.tar.gz  the source .zwo library, to regenerate data/
├── README.md  AGENTS.md  DESIGN.md
└── package.json
```

## Building

Node 18+ (CI uses Node 24). The engine has no runtime dependencies; esbuild is only used to
bundle the app.

```sh
npm install          # once
npm run index        # library (..) → data/*.json, then rules.json
npm test             # sample plans + checks, must end with "problems: 0"
npm run review       # dist/library-index.html (review page for the classification)
npm run build        # dist/zwo-workout-builder.html
npm run all          # all of the above
```

`npm test` and `npm run build` work from the committed `data/`; `npm run index` is only
needed when the library or the classification in `src/core` changes.

`npm run index` reads the parent folder, so it only works when the repo sits inside the
workout library (one sub-folder per plan or collection, files `WeekNN_DayNN_<Name>.zwo`;
folders starting with `_` or `.` are skipped). Otherwise index the committed snapshot:

```sh
mkdir -p /tmp/zwo-library && tar xzf library-snapshot.tar.gz -C /tmp/zwo-library
node scripts/build-index.mjs /tmp/zwo-library data && node scripts/derive-rules.mjs data
```

The app embeds the engine data gzip-compressed and base64-encoded (about 0.24 MB instead of
1.15 MB); the browser unpacks it with `DecompressionStream`.

## Data (`data/`)

| File | Content |
|---|---|
| `catalog.json` | one entry per library workout: duration, TSS, IF, NP, level 1–5, primary/secondary type, flags, minutes per zone, work minutes per type, structure text, power profile |
| `library.json` | engine input: type, level, flags, work minutes and compact power blocks |
| `plans.json` | per folder: plan or collection, weekly hours/TSS/hard sessions, recovery weeks, intensity distribution |
| `patterns.json` | repeated interval sets across the library |
| `rules.json` | learned rules: work dose per type and duration, weekly load increase, recovery-week load, block length, TSS per hour, long-ride share, hard sessions per week |
| `summary.json` | counts by type, level, duration, type × duration |

The library's titles, descriptions and plan names stay in `data/` and the review page.
The app bundle contains only power structures and metrics (`build-app.mjs` keeps `primary,
secondary, level, flags, workMin, durMin, blocks` per workout), and no generated name or
description refers to the library.

## How it works

### Classification

Coggan power zones (% FTP): Z1 <56, Z2 56–75, Z3 76–90, Z4 91–105, Z5 106–120, Z6 121–150, Z7 >150.

Every steady or interval block outside warm-up/cool-down with ≥80 % FTP is a work block:

| Avg power | Duration / context | Type |
|---|---|---|
| ≥150 % | ≤30 s | sprint |
| ≥150 % | >30 s | anaerobic |
| 121–150 % | >3 min, or ≤40 s with ≤60 s rest (30/30, 40/20) | vo2max |
| 121–150 % | otherwise | anaerobic |
| 106–120 % | ≤10 min | vo2max |
| 95.5–106 % | | threshold |
| 87.5–95.5 % | | sweet spot |
| 80–87.5 % | | tempo |

Work time is weighted by cost (tempo 0.6 … sprint 6); the top score is the primary type, a
second type with ≥35 % of that score is secondary. Little work (<6 %) means endurance or
recovery; low-IF sessions are never labelled hard; a title that names one type decides
between types the metrics found. FreeRide counts as 60 % FTP for load.

### Plans

- **Athlete level** 1–5 from W/kg, recent hours and experience. Starting load ≈ hours × 52 TSS.
- **Build-up for under-trained riders**: when the current load is below 60 % of what the
  schedule offers (≈ 50 TSS per available hour), the plan starts from the current load, ramps
  up to 10 % per build week and allows one key session in the first block (two afterwards).
  If a week is still more than 15 % over its target with every session at its minimum
  length, easy and recovery days become rest days.
- **Weeks**: three build weeks, then a recovery week (≈55 % load). Load grows 4–8 % per build
  week (intensity setting). Event plans end with a taper week. Phases: 40 % base,
  40 % build, 20 % peak.
- **Week layout**: the longest day is the long ride; 1–3 key sessions (by days, level,
  intensity, style) go on days that keep hard sessions apart (Sunday → Monday counts as
  adjacent) and not on the day after the long ride (strongly penalised; advanced riders
  may get it as a weekend block when no other day fits); the day after a key session
  is a recovery ride for less experienced riders. Sessions shrink when a week overshoots its
  load target; available time caps the load ("time-limited"). The cap is the TSS of the
  week's sessions generated at full slot length (plus room for easy rides to grow back to the
  offered time), so the target line never promises load the schedule cannot deliver, and the
  next week ramps from the capped value. When a load week falls short of its target, easy
  rides grow back towards the minutes the rider offered.
- **Key session types** rotate through a list per goal and phase, changed by style
  (polarized: threshold/VO2 instead of tempo/sweet spot; sweet spot: sub-threshold until the
  peak) and weak spots (added in build and peak). Climbing, racing and gravel keep VO2max
  in the list from the build phase on, whatever the style. The first key slot of a week takes
  the phase's main focus; further slots take the category used least so far in that phase,
  so every category and weak spot comes round (with one key slot a week, the focus counts
  double).
- **Workouts**: either a library structure of the right type whose main set fits the slot
  (extra time becomes endurance riding), or a composed one: warm-up (+ openers before hard
  sessions), the interval format whose work time is closest to the target dose, aerobic
  filler, cool-down. The target dose comes from the library's work minutes per type and
  duration (`rules.workDoseMin`).
- **Library structure filter** (`structureFits` in `library.js`): a library main set is only
  used when it trains what its type promises — sweet spot / threshold with most work in
  efforts of ≥ 4 / 3 min, anaerobic efforts with recoveries ≥ 1.5× the effort, sprints at
  ≥ 170 % FTP with ≥ 2 min recovery. Hard sessions keep a library warm-up only if it lasts
  ≥ 8 min; otherwise a 10 min ramp is used.
- **FTP ramp test** (`rampTest` in `compose.js`) is built by the app, not taken from the
  library (the library's ramp-test files are only placeholders for a test the original platform
  runs internally): 8 min warm-up ramp + 2 min easy, 1 min steps from 50 % FTP rising 6 % per
  minute up to 152 %, ridden until the target can no longer be held, 12 min cool-down; 40 min in
  total. The description explains the result: new FTP ≈ 75 % of the best 1-minute power (about
  the last full step). TSS/IF/NP are given for a typical finish (last full step ≈ 134 %).
- **FTP test placement** (optional): in week 1 and, without an event, in the last week of
  plans with ≥ 6 weeks, which becomes a lighter test week (like the library's plans, whose
  final test week carries 30–70 % less load). The test takes one key slot and goes on an
  indoor day after a rest day (or an easy ride, never right after the long ride): early in
  week 1, late in the final week. No key session on the day before or after it.
- **Sprints** are written as `<MaxEffort>` blocks (all-out, ERG released, shown as "MAX"),
  both in sprint sessions and inside long rides; load and classification count them at an
  assumed 200 % FTP (150 % for efforts over 30 s).

### Names

- Interval sessions: series name per type + running number + main set,
  e.g. `Red Line #3: Over-Unders 3x9min`, `Lung Opener #2: VO2 5x4min`
- Endurance / recovery: name + duration, e.g. `Base Miles: Endurance 120min`
- Single workouts: no number, e.g. `Hot Seat: Threshold 7x3min`
- XML `<name>`: `<Plan> - Week 3 Day 2 - <name>`, e.g. `FTP Builder 10wk - Week 3 Day 2 - …`
- Description: type, purpose, main set, duration/TSS/IF/NP, plan week and phase

## Checks

`npm test` builds six sample plans (beginner, FTP, polarized racer, gran fondo with an
outdoor day, comeback with far more time than current fitness, time-crunched sweet spot on
two days a week) plus single workouts, and reports:

- weeks more than 15 % over their load target, week 1 above 1.3 × the current load, slot
  durations not met (±2 min)
- key sessions after a ≥ 150 min ride (levels 1–3); back-to-back hard days are listed
- a hard session the day before or after the FTP test, or the test right after the long ride
- a key category of a phase that never comes round in that phase
- TSS changes after writing and re-parsing the `.zwo` files
- `.ictx` files: well-formed envelope and balanced tags, `displayOrder`, leg durations equal
  to the block durations, level badges, `exerciseType`, `workoutStruct` parts and
  `maxLevelRatioDisplay`
- whether the classifier recognises each generated workout as its intended type
  (currently 205/207)
- duplicate file names

It ends with `problems: N` and exits non-zero when N > 0, which fails CI and releases.

`npm run check-labels` compares library labels with the coach-given titles.

## Releases and deployment

GitHub Actions workflows in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `build.yml` | reusable (called by the others) | `npm ci`, `npm test`, `npm run build`; optionally uploads `dist/zwo-workout-builder.html` as an artifact |
| `ci.yml` | push to `develop`, pull requests into `develop` (docs-only changes skipped) | runs `build.yml` |
| `prepare-release.yml` | manual: Actions → "Prepare release" → patch / minor / major | CI gate, bumps the version in `package.json` / `package-lock.json`, commits `chore(release): X`, pushes branch and tag `vX`, then runs `release.yml` |
| `release.yml` | called by `prepare-release.yml`, a release published in the GitHub UI, or manual (tag input) | pipeline **build → GitHub Release → GitHub Pages**: tests and builds the tag, checks it matches `package.json`, creates the Release or attaches to it (`zwo-workout-builder.html` + a versioned copy), then runs `deploy-pages.yml` with the same file |
| `deploy-pages.yml` | called by `release.yml`, or manual (any branch) | publishes the app as `index.html` on GitHub Pages; run manually it builds the chosen branch first |

GitHub Pages therefore always shows the latest release. Running "Release" manually with an
older tag re-publishes that tag's assets and redeploys it (rollback).

One-time setup:

- **Pages:** Settings → Pages → Build and deployment → Source: **GitHub Actions**.
- **Pages environment:** releases cut with "Prepare release" deploy from `develop`, which the
  `github-pages` environment already allows. A release published in the GitHub UI deploys from
  its tag, so add a tag rule `v*` under Settings → Environments → github-pages → Deployment
  branches and tags.
- **Releasing from the UI:** bump `version` in `package.json` on `develop` first and tag that
  commit `vX.Y.Z`; the pipeline stops before attaching files or deploying if tag and
  `package.json` differ. "Prepare release" does the bump for you.
- No secrets needed: everything runs with the default `GITHUB_TOKEN` (`develop` must stay
  pushable by GitHub Actions, i.e. no branch protection that blocks it).

`npm test` exits non-zero when a check reports a problem, so a broken engine stops both
the release and the deployment. Pushes to `develop` don't change the live site. Running
"Deploy app to GitHub Pages" manually publishes the chosen branch instead, until the next
release (or a manual "Release" run) puts a tagged build back.
