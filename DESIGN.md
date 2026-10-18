# DESIGN.md

The visual and interaction design of the Zwo Workout Builder. The source of truth for tokens
is the `:root` block in `src/app/template.html`; this file explains them and the rules for
using them.

## Direction

A **bike head unit** in the browser: dark data panels with big monospaced readouts, a
condensed italic display face that suggests speed, and the training zone colours as the
visual language. Sporty, but a tool first: every screen is something you operate, not read.

Recurring motifs:

- **Zone spectrum**: the seven zone colours as a strip under the header and in the logo mark.
- **Ramp-test progress**: each wizard step fills a slanted bar in the next zone colour
  (Z1 → Z6), like the steps of a ramp test.
- **Head unit**: the "Your ride" summary and the plan stats row are always-dark panels with
  mono numbers and small uppercase labels.

## Colour

All colours are CSS custom properties. Components use tokens only, never literal values.
Every token has a light value on `:root`, and dark values under
`@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and
`:root[data-theme="dark"]`.

### Surface and text

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#eef0f3` | `#0b0d10` | page background |
| `--panel` | `#ffffff` | `#14171c` | cards, wizard panel |
| `--sunk` | `#f3f4f7` | `#1b1f26` | inputs, inactive cells, detail panel |
| `--ink` | `#12151a` | `#eceef2` | text, selected segmented button |
| `--muted` | `#5a6271` | `#9aa2b0` | secondary text, labels |
| `--line` | `#dadee5` | `#2a2f38` | borders, empty tracks |

### Accent and status

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | `#d1006b` | `#ff4fa3` | primary action, selection, active riding day, slider fill |
| `--accent-ink` | `#ffffff` | `#160710` | text on accent |
| `--warn` | `#a85a00` | `#f5a524` | validation hints, "time-limited" |
| `--good` | `#1f8a4c` | `#4ccf83` | reserved for success states |

The accent is a race-leader pink, chosen to stay clear of the zone colours and of Zwift's
orange. Use it for **what the user does or has chosen**, never for data.

### Head unit (always dark)

| Token | Light theme | Dark theme |
|---|---|---|
| `--unit-bg` | `#12151a` | `#050607` |
| `--unit-fg` | `#eef0f3` | `#eceef2` |
| `--unit-dim` | `#8e96a4` | `#8e96a4` |
| `--unit-line` | `#2a2f38` | `#23272e` |
| `--unit-cell` | `#1c2027` | `#13161b` |

Used by the "Your ride" panel, the plan stats row and the logo mark.

### Training zones (data colours)

| Token | Zone | % FTP | Light | Dark | Types |
|---|---|---|---|---|---|
| `--z1` | Z1 recovery | <56 | `#8a929e` | `#8d96a3` | recovery, test, warm-up/cool-down ramps |
| `--z2` | Z2 endurance | 56–75 | `#2f7fd8` | `#4d97ec` | endurance, build weeks, outdoor rides |
| `--z3` | Z3 tempo | 76–90 | `#2e9e5b` | `#3fbd72` | tempo, recovery weeks |
| `--z4` | Z4 threshold | 91–105 | `#e0b10f` | `#f0c62b` | sweet spot, threshold |
| `--z5` | Z5 VO2max | 106–120 | `#ea6a1f` | `#ff8336` | VO2max |
| `--z6` | Z6 anaerobic | 121–150 | `#d6332d` | `#ef4d45` | anaerobic, peak phase |
| `--z7` | Z7 neuromuscular | >150 | `#8f2fd1` | `#b06af0` | sprint |
| `--free` | free ride | – | `#b8bdc6` | `#4a515c` | blocks without a target |

Rules:
- Zone colours encode **intensity only**: power profiles, zone bars, type chips, the colour
  edge on calendar cells, the goal and style mix bars.
- A workout type always maps to the same zone colour (`ZONE_OF` in `main.js`).
- Never use a zone colour for buttons, links or selection.
- Text on zone colours: use `--ink` on a tinted background
  (`color-mix(in srgb, var(--z4) 18%, transparent)`) rather than text on the solid colour.

## Typography

| Role | Token | Font | Use |
|---|---|---|---|
| Display | `--f-display` | Barlow Condensed, italic 700–800, uppercase | app name, step titles (h2), plan name, week titles, card titles, workout names in details |
| Body | `--f-body` | Barlow 400–700 | text, buttons, inputs |
| Data | `--f-mono` | JetBrains Mono 500–700, tabular figures | FTP, W/kg, TSS, IF, NP, durations, file names |

Fallbacks: `"Arial Narrow"`, `system-ui`, `ui-monospace`. Fonts come from Google Fonts; the
offline file falls back to system fonts without breaking layout.

Scale:
- Step title (h2): `clamp(1.7rem, 3.2vw, 2.3rem)`, line-height 1
- Plan name: `clamp(2rem, 4.5vw, 3rem)`
- Big inputs (FTP, weight): 2.2 rem mono (1.7 rem on phones)
- Readouts: 1.45–1.9 rem mono
- Body 16 px / 1.45; hints 0.92 rem in `--muted`
- Labels and eyebrows: 0.68–0.72 rem, uppercase, letter-spacing 0.12–0.14 em, weight 700

Numbers that line up in columns always use `--f-mono` with `tabular-nums`.

## Layout

- Max width 1180 px, side gutter `max(16px, env(safe-area-inset-left/right))`.
- Wizard: panel (`minmax(0, 1fr)`) + 300 px "Your ride" sidebar (sticky). Below 980 px the
  sidebar moves above the panel as a compact tile row; on the result step it is hidden.
- Spacing with `gap` on grid/flex, not margins. Panel padding `clamp(18px, 3vw, 30px)`.
- Radii: 16 px panels, 12–14 px cards, 10 px buttons/inputs, 999 px pills.
- Phone (≤760 px): step labels replaced by "Step n of m · Name"; Back/Next is a fixed bottom
  bar; day tiles in two columns; calendar becomes a list with rest days hidden.
- The body never scrolls horizontally. Charts and the calendar shrink with their container.

## Components

| Component | Notes |
|---|---|
| **Brand bar** | logo mark (zone bars on `--unit-bg`), app name in display face with "Workout" in accent, theme switch on the right. The logo is a link back to the start (mode selection); answers and the last result are kept |
| **Theme switch** | three icon buttons: system, light, dark. Stored in `localStorage` (`zwo-builder-theme`), applied as `data-theme` on `<html>`; "system" removes the attribute |
| **Step rail** | slanted bars (`skewX(-18deg)`), filled with the step's zone colour when done or current; current bar has a ring. Steps ahead are disabled until a result exists |
| **Choice card** | border 1.5 px `--line`; selected: accent border, 3 px accent glow, round check badge top right. Title in display face, subline in `--muted`, optional art or mix bar at the bottom |
| **Mix bar** | 6 px bar showing a distribution in zone colours (goal focus, style easy/moderate/hard) |
| **Big input** | number in 2.2 rem mono on `--sunk`, unit in display face; accent border on focus |
| **Slider** | 8 px track filled with accent up to the value (`--p`), white thumb with accent ring, value shown right in mono |
| **Segmented control** | `--sunk` track; selected segment `--ink` background with `--bg` text |
| **Chip button** | pill with a small dot in its colour (`--c`); selected: tinted background and coloured border |
| **Switch** | 44 × 26 track, accent when on; replaces checkboxes |
| **Day tile** | dashed when resting; solid accent border when riding, blue (`--z2`) when outdoor. Day name in display face, − / + stepper in 15-minute steps, "Outdoor" toggle |
| **Readout row** | three bordered cells: value (mono or display) over an uppercase label |
| **Head unit panel** | always-dark tiles with mono values; week strip of seven day cells (accent = indoor, blue = outdoor) |
| **Primary "Next" button** | accent, display face, uppercase, parallelogram (`clip-path`) |
| **Buttons** | primary = accent fill; secondary = panel with border; ghost = transparent. Download buttons carry a download icon |
| **Stats row** | head-unit styling, five cells: weeks, workouts, hours, total TSS, TSS per week |
| **Load chart** | one bar per week: build `--z2`, recovery `--z3`, taper accent; target as a dark tick; value above; phase strip below (base `--z2`, build `--z4`, peak `--z6`) |
| **Week card** | display-face title, phase pill, hours/TSS right; seven cells. Session cell: 4 px left edge in the type's zone colour, mini power profile, duration and TSS. Rest: dashed outline. Outdoor: striped blue edge |
| **Workout detail** | name in display face, type chip, metric readouts (time, TSS, IF, NP), power profile with watt axis and dashed FTP line, zone bar, description, file name in mono |
| **Toast** | inverted (`--ink` on `--bg`), bottom centre, 3.5 s, `role="status"` |

## Interaction

- One `render()` redraws the step; inputs update the sidebar live without a full redraw.
- The "Next" button is disabled with the reason shown beside it (e.g. "Pick at least one day").
- Selected state is always shown twice: colour plus a second cue (check badge, ring, filled
  background, `aria-pressed`).
- Focus: 2 px accent outline with 2 px offset on every interactive element.
- Motion: short transitions (0.15–0.35 s) on hover lift, rail fill and switches only; all
  disabled under `prefers-reduced-motion`.
- Downloads confirm with a toast naming the file.

## Copy

- Plain English, short sentences, active voice. Buttons say what happens:
  "Build my plan", "Download plan (.zip)", "Swap for another".
- Explain training terms once where they appear (TSS on the rider step).
- Never mention the workout library, its coaches or plan names in the UI or in generated
  names and descriptions.
- Units always shown: W, kg, W/kg, min/h, TSS, IF.

## Accessibility

- Text contrast at least 4.5:1 on its surface in both themes; `--muted` is the lightest
  allowed text colour.
- All controls are real `<button>`/`<input>` elements with labels or `aria-label`;
  toggles use `aria-pressed`, the rail uses `aria-current="step"`.
- Charts are decorative duplicates of numbers shown as text (week TSS, metrics).
