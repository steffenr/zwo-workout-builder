# Zwo Workout Builder

A guided wizard that builds Zwift training plans and single workouts (`.zwo`), fully offline.

It learns from a library of existing `.zwo` workouts: every workout is parsed and classified
by its power profile, and plan rules (load progression, recovery weeks, work doses) are derived
from the multi-week plans. The wizard then builds plans and workouts that fit the rider's
FTP, training status, goal, weekly schedule and preferred style.

No AI service, no server, no account: the app is one HTML file.

## Using the app

Open **`dist/zwo-workout-builder.html`** in a browser.

1. **Mode** — training plan or single workout
2. **Rider** — FTP, weight, hours per week over the last 4–6 weeks, structured-training experience
3. **Goal** (plan) — goal, plan length in weeks or until an event date, optional FTP ramp test
   **Workout** (single) — training type or "Pick for me", length
4. **Week** (plan) — riding days, minutes per day, outdoor rides (counted for load, no file)
5. **Style** — training style (pyramidal / polarized / sweet spot / auto), intensity,
   rider type, weak spots, cadence drills
6. **Result**
   - Plan: load chart, week × day calendar, workout details with power profile in watts,
     "Swap for another", **Download plan (.zip)**
   - Single: three options, each as **Download .zwo**, or all as a .zip

Plan ZIP layout:

```
<plan-slug>/
  Week01_Day02_Red_Line_#1_Threshold_4x5min.zwo   # Day = weekday, 1 = Monday
  Week01_Day07_Base_Miles_Endurance_120min.zwo
  …
  plan-overview.md
```

Copy the folder into Zwift's `Documents/Zwift/Workouts/<user id>/`, or convert it with
WoZ Tools. Power targets are % of FTP, so the files work for any FTP.

Clicking the logo returns to the mode selection; answers and the last result are kept.
Answers and the chosen colour theme (system / light / dark) are stored in the browser's
local storage only.

**Inside claude.ai** the published copy of the app can only save `.zip` files; single
workouts then come as a `.zwo` inside a `.zip`. The local HTML file saves `.zwo` directly.

## Project layout

```
_workout-builder/            lives inside the workout library folder (folders starting with _ are skipped)
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
│   │   ├── blocks.js        block constructors, compact encoding
│   │   └── rng.js           seeded PRNG + hash (same answers → same plan)
│   ├── app/                 wizard UI: main.js + template.html
│   └── browser/             template of the library review page
├── scripts/
│   ├── build-index.mjs      library → data/*.json
│   ├── derive-rules.mjs     plans → data/rules.json
│   ├── check-labels.mjs     labels vs. coach-given titles (quality check)
│   ├── test-engine.mjs      sample athletes → plans, checks
│   ├── build-browser.mjs    dist/library-index.html
│   └── build-app.mjs        dist/zwo-workout-builder.html (esbuild bundle + data)
├── data/                    generated knowledge base (see below)
├── dist/                    generated pages
├── README.md  AGENTS.md  DESIGN.md
└── package.json
```

## Building

Node 18+. The engine has no runtime dependencies; esbuild is only used to bundle the app.

```sh
npm install          # once
npm run index        # library (..) → data/*.json, then rules.json
npm test             # sample plans + checks, must end with "problems: 0"
npm run review       # dist/library-index.html (review page for the classification)
npm run build        # dist/zwo-workout-builder.html
npm run all          # all of the above
```

After adding or removing workouts in the library, run `npm run all`.

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
The app bundle contains only power structures and metrics, and no generated name or
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
  intensity, style) go on days that keep hard sessions apart; the day after a key session
  is a recovery ride for less experienced riders. Sessions shrink when a week overshoots its
  load target; available time caps the load ("time-limited").
- **Key session types** rotate through a list per goal and phase, changed by style
  (polarized: threshold/VO2 instead of tempo/sweet spot; sweet spot: sub-threshold until the
  peak) and weak spots (added in build and peak).
- **Workouts**: either a library structure of the right type whose main set fits the slot
  (extra time becomes endurance riding), or a composed one: warm-up (+ openers before hard
  sessions), the interval format whose work time is closest to the target dose, aerobic
  filler, cool-down. The target dose comes from the library's work minutes per type and
  duration (`rules.workDoseMin`).

### Names

- Interval sessions: series name per type + running number + main set,
  e.g. `Red Line #3: Over-Unders 3x9min`, `Lung Opener #2: VO2 5x4min`
- Endurance / recovery: name + duration, e.g. `Base Miles: Endurance 120min`
- Single workouts: no number, e.g. `Hot Seat: Threshold 7x3min`
- XML `<name>`: `<Plan> - Week 3 Day 2 - <name>`, e.g. `FTP Builder 10wk - Week 3 Day 2 - …`
- Description: type, purpose, main set, duration/TSS/IF/NP, plan week and phase

## Checks

`npm test` builds six sample plans (beginner, FTP, polarized racer, gran fondo with an
outdoor day, comeback with far more time than current fitness, two days a week) and reports:

- weeks over their load target, week 1 above 1.3 × the current load, slot durations not met
- back-to-back hard days
- TSS changes after writing and re-parsing the `.zwo` files
- whether the classifier recognises each generated workout as its intended type
- duplicate file names

`npm run check-labels` compares library labels with the coach-given titles.
