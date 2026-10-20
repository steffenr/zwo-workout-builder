# DESIGN.md — zwoWorkoutBuilder design system

zwoWorkoutBuilder uses the design system of **zwoTrainer** (`../zwoTrainer/DESIGN.md`,
`ui/css/styles.css`), so both apps look and behave like one product. This file lists what
the builder uses from it, the few builder-specific components, and the rules for changes.

Everything lives in `src/app/template.html` (tokens on `:root`, component CSS), the app
icon `src/app/icon.svg` and a few constants in `src/app/main.js` (`ZONE_BOUNDS`, `ZONES`,
`ZONE_OF`). If zwoTrainer changes a
token or a shared component, mirror the change here. A new pattern is documented here.

## Principles

1. **Calm and clean.** The workout is the hero. Few controls, generous whitespace, no
   decoration that doesn't carry information.
2. **Colour means zone.** The five zone colours are reserved for training intensity. UI
   chrome uses neutral greys and one accent.
3. **Same structure everywhere.** The top bar never changes shape; one primary action per
   view or dialog, placed last (right); dialogs share one layout.
4. **Light and dark are equals.** Light mode is pure white (`#fff`), dark mode pure black
   (`#000`). Every element is checked in both.
5. **One family with zwoTrainer.** Same tokens, fonts, icon, zone palette and component
   classes; the brand reads `zwo` + accent word (`zwoTrainer`, `zwoWorkoutBuilder`).

## Colour

### Theme tokens

Always use tokens (`var(--…)`), never raw hex in components. Dark values apply via
`prefers-color-scheme` unless the user picked a theme in Settings
(`:root[data-theme="light|dark"]`).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#ffffff` | `#000000` | page background |
| `--surface` | `#ffffff` | `#0b0b0c` | cards, dialog, inputs, workout rows |
| `--surface-2` | `#f5f6f8` | `#141416` | hover, segmented-control track, profile backgrounds, resting days |
| `--surface-3` | `#eceef2` | `#1c1c1f` | code chips, muted badges, step numbers |
| `--line` | `#e5e7eb` | `#232326` | borders, dividers |
| `--line-strong` | `#cfd3da` | `#34343a` | input borders, hover borders, taper weeks |
| `--text` | `#1f2328` | `#f2f2f3` | primary text |
| `--text-2` | `#555555` | `#cccccc` | secondary text, descriptions |
| `--muted` | `#8a9099` | `#85858d` | labels, meta |
| `--accent` | `#00a3c4` | `#1cc4e6` | primary buttons, selection, current step, progress, build weeks |
| `--accent-hover` | `#0090ad` | `#44d2ee` | primary button hover |
| `--accent-ink` | `#ffffff` | `#001318` | text on accent |
| `--accent-soft` | 10 % accent | 14 % accent | selected backgrounds, day badges, done steps |
| `--ok` / `--ok-soft` | `#2e9e4f` | `#4cd07a` | success |
| `--warn` / `--warn-soft` | `#b7791f` | `#f2c14e` | validation hints, "Time-limited" |
| `--danger` | `#e0352b` | `#ff5a4f` | destructive actions (none yet) |
| `--ftp` | text colour | white | FTP line in profiles |
| `--track` | `#eceef2` | `#1c1c1f` | progress-bar track |

### Zone colours (fixed; identical in both themes)

Five zones as in zwoTrainer. Upper bounds of Z1–Z4 in % FTP: `ZONE_BOUNDS = [55, 75, 90, 105]`;
everything above 105 % is Z5.

| Zone | Fill | Text ink (light / dark) | Workout types (`ZONE_OF`) |
|---|---|---|---|
| Z1 Recovery | `#7f7f7f` | `#6b6b6b` / `#a6a6a6` | recovery |
| Z2 Base endurance | `#338cff` | `#1f74e0` / `#5aa4ff` | endurance |
| Z3 Tempo | `#59bf59` | `#2f9a3a` / `#6fd06f` | tempo |
| Z4 Threshold | `#ffcc3f` | `#b88a00` / `#ffcc3f` | sweet spot, threshold, FTP test |
| Z5 VO2max | `#ff6639` | `#e4501f` / `#ff7a52` | VO2max, anaerobic, sprint |
| Free ride | `#b4bac2` | — | blocks without a target |

- **Fills** (`--z1`…`--z5`, `--free`) are for profile bars, zone tags, zone bars, chip dots
  and the goal/style mix bars. Text on a fill is black (`.ztag`).
- **Inks** (`--z1-ink`…`--z5-ink`) are for coloured text on the page background, such as
  target watts in the segment info line.
- **Never** use zone colours for buttons, status or decoration. The weekly load chart uses
  the accent (build), soft accent (recovery) and `--line-strong` (taper), not zones.
- The engine still classifies with seven Coggan zones; the UI shows five.

## Typography

| Role | Token | Font | Use |
|---|---|---|---|
| UI text | `--font` | SF Pro Text / system (Segoe UI Variable, Roboto, Noto Sans, Cantarell) | 15 px / 1.45 body |
| Numbers | `--num` | SF Pro Rounded / `ui-rounded` (Segoe UI, Roboto elsewhere) | stats, durations, watts, TSS, tabular figures |
| Code / paths | `--mono` | `ui-monospace`, SF Mono, Menlo | 12 px file names in `code` chips |

No web fonts: the offline file renders the same everywhere.

| Element | Size and weight |
|---|---|
| `h1` | 22 px on phones, 26 px from 760 px, 650 (step titles, plan name) |
| `h2` | 18 px / 19 px (dialog title) |
| `h3` | 15 px (card titles) |
| `.meta` | 13.5 px, muted |
| `.small` | 13 px |
| `.k` labels | 11 px, uppercase, letter-spacing .08em, 600, muted |
| `.eyebrow` | 11.5 px, uppercase, .09em |
| Stats values | 20 px on phones, 22 px from 600 px, `--num`, 600 |

Headings use `letter-spacing: -0.01em`. Numbers in columns always use tabular figures.

## Spacing, radius, elevation

| Category | Values |
|---|---|
| Spacing | 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 32 px |
| Page | `.view` max-width 1120 px, padding 16 px on phones, 24 px from 760 px (safe-area aware) |
| Sections | `.section` margin-top 32 px; week headers 26 px above their list |
| Radius | dialog 18 px · cards 14 px (`--radius`) · popover 12 px · day tiles 12 px · buttons and inputs 10 px · rows 11 px · small buttons 8 px · tags 5–6 px · pills 99 px · round buttons 50 % |
| Elevation | `--shadow` subtle on cards (none in dark) · `--shadow-lg` for dialog, popover, toast · dark mode relies on borders |

Z-index: top bar 5 · install hint 90 · toast 100 · popover 200 (the dialog uses the browser's top layer).

## Layout

### App shell

```
┌ top bar (sticky, 64 px, blurred bg, bottom border; content max 1120 px) ───┐
│ [icon] zwoWorkoutBuilder                         zwoTrainer  [GH] [☕] [⚙] │
└────────────────────────────────────────────────────────────────────────────┘
#view (max 1120 px)
  step tabs:  (✓) Mode  (✓) Rider  (3) Goal  (4) Week  (5) Style  (6) Result
  wizard:     [ step card ··························· ] [ Your answers ]
  or result:  plan head · stats · weekly load · week lists
<dialog id="modal"> workout details · #popover settings · #toast
```

- **Top bar:** mirrors the header of the zwoTrainer website (`../zwoTrainer/site/site.css`,
  `.nav`): 64 px, `--bg` at 82 % with `saturate(1.6) blur(14px)`, bottom border, content in
  `.topbar-inner` aligned with `#view` (max 1120 px). Brand left (30 px app icon with radius 7,
  21 px `zwo<b>WorkoutBuilder</b>`, `b` accent 600; links back to the mode selection). Right
  (`.nav-links`): text link zwoTrainer (website; 15 px / 500, `--text-2`, `--surface-2` on
  hover, radius 10; from 760 px), then GitHub (`#link-github`, GitHub mark) and Buy me a coffee
  (`#link-coffee`, cup) as icon-only links (`a.ico`, 38 × 38, 18 px icon, label in
  `title` + `aria-label`), then Settings (`.nav-btn`, gear) as the last item. External links
  open in a new tab. On phones the bar is 56 px, the brand 18 px with a 26 px icon, the
  icon links 40 × 40 and the zwoTrainer link is hidden. Nothing else; new options go in Settings.
- **Step tabs** (`.tabs`): numbered steps; current = accent underline and filled number,
  done = check in soft accent, future = disabled until a result exists. Below 760 px only the
  current step shows its label.
- **Wizard:** the step card (`.card.step`) plus a 280 px sticky summary card ("Your answers").
  Each step ends with an action row: validation hint left, Back (ghost), Next / Build
  (primary, last). On phones the row is sticky at the bottom of the screen (hint on its own
  line above the buttons).
- **Result:** plan head (eyebrow, h1, meta; actions right), stats card, weekly load card,
  hint, then one `.wk-head` + `.wlist` per week.

### Responsive (mobile first)

The base CSS is the phone layout (from 320 px); wider layouts are added with `min-width`
queries. Touch sizes are the default; mouse users get the compact desktop sizes through
`(hover: hover) and (pointer: fine)`, so a touch tablet keeps large targets at any width.
Hover effects only apply under `(hover: hover)`.

| Width | Layout |
|---|---|
| base (phones) | 16 px page gutter; 56 px top bar (zwoTrainer link hidden); step tabs show only the current label; step card first, "Your answers" below it (2 columns, no week strip); step actions are a sticky bar at the bottom of the screen with Back and Next sharing the width; form rows wrap (sliders and segmented controls full width, equal segments); goal cards in 2 columns, day tiles in 2; workout rows show day · title · zone + TSS; plan head stacked, secondary actions side by side and the primary download full width below them; plan stats in 3 columns; the workout dialog is a bottom sheet with pinned actions |
| ≥ 480 px | day tiles in 3 columns; rider readout in 3 columns |
| ≥ 600 px | cards 20 px padding; "Your answers" above the step as a 4-column grid; day tiles in 4; workout rows add the duration; the dialog is the centred 760 px dialog |
| ≥ 760 px | 24 px gutter, 64 px top bar with the zwoTrainer link; all step labels; step actions back inside the card (right-aligned); day tiles in 7 columns; plan stats in 5 |
| ≥ 980 px | "Your answers" becomes the 280 px sticky sidebar; plan head with actions on the right |
| ≥ 1100 px | workout rows add the mini profile |
| < 360 px | the only `max-width` rule: a smaller wordmark in the top bar |

- Touch targets are at least 44 px (buttons, tabs, inputs, check boxes' labels, day-tile
  toggles, stepper halves 44 × 36); chips 40 px, segmented items 38 px, Outdoor toggle 32 px.
- Inputs use 16 px text on touch devices so iOS does not zoom in.
- The viewport uses `viewport-fit=cover`; top bar, page, sticky bars, toast and install hint
  respect the safe-area insets.
- The body never scrolls horizontally (checked at 320, 390, 768 and 1280 px; the step tabs
  scroll inside their own row if they don't fit).

## Components

### Shared with zwoTrainer

| Component | Spec |
|---|---|
| **Button** `.btn` | 1 px `--line-strong` border, `--surface`, 600 14 px, radius 10, padding 9 × 16. `.primary` (accent fill), `.ghost` (transparent), `.sm` (13 px, radius 8), `.round` (circle). One primary per view or dialog, placed last. Download buttons carry the download icon. |
| **Icon button** `.icon-btn` | 36 × 36, transparent, muted icon, `--surface-2` on hover; `title` + `aria-label`. External links get `target="_blank" rel="noopener noreferrer"` and say "(opens in a new tab)" in the label. |
| **Top-bar button** `.nav-btn` | 38 × 38, 1 px `--line-strong` border, radius 10, 18 px icon in `--text-2`; `--surface-2` on hover or while open. Same as the website's theme button. Only used for Settings. |
| **Segmented control** `.seg-ctl` | `--surface-2` track, radius 10, 3 px padding; selected item is a raised `--surface` pill. Used for experience, plan length and the theme. |
| **Card** `.card` | `--surface`, 1 px `--line`, radius 14, padding 20, `--shadow`. |
| **Tabs** `.tabs` | 14 px 600 muted, accent 2 px underline on the current item. Used for the wizard steps. |
| **Workout row** `.wrow` | grid: day badge (`.wd`) · title + meta · mini profile 200 × 28 · duration · zone tag + TSS. Radius 11, hover border `--line-strong`; the open workout gets the accent border and soft gradient. Outdoor rides are a non-clickable row on `--surface-2`. Rows are focusable; Enter or Space opens. |
| **Day badge** `.wd` | 11 px 700 accent on `--accent-soft`, radius 6 ("Tue"). Muted for outdoor rides. |
| **Zone tag** `.ztag` | zone fill, black 11 px 650 "Z1–Z5", radius 5, min-width 26. |
| **Zone chip** `.zchip` | zone-filter pattern: outlined, 9 px coloured dot; on = border in its colour and 16 % background. Uses the zone fill for training types and weak spots, the accent for other choices (rider type, "Pick for me"). |
| **Badge** `.badge` | 11 px 700, radius 6; `.muted` (phase), `.warn` (time-limited), `.ok`. |
| **Dialog** `dialog` | radius 18, `--shadow-lg`, blurred `--backdrop`, width 760. `.pv-head` with eyebrow + title left and ✕ right; actions in `.modal-actions`: Swap (ghost, left), Download .ictx, Download .zwo (primary, last). Esc and backdrop click close it. Below 600 px it is a bottom sheet (full width, top corners rounded) whose action row stays pinned to the bottom. |
| **Profile** `.pv-diagram` | `--surface-2` box, radius 12, watt axis as HTML ticks on the left (never SVG text), dashed `--ftp` line, bars stretch (`preserveAspectRatio="none"`). |
| **Segment info** `.seg-info` | one 13.5 px line: kind · duration · target watts in zone ink (+ % FTP, zone, rpm). Updates on hover/tap; the selected bar gets an accent outline. |
| **Zones bar / legend** | 10 px bar with 2 px gaps; legend with 9 px squares, zone name and minutes. |
| **Popover** `.popover` | radius 12, `--shadow-lg`, 6 px padding, 260 px minimum; `.pop-title` uppercase 11 px. Settings: Appearance (Match system / Light / Dark). Closes on outside click and Esc. |
| **Inputs** | `--surface`, 1 px `--line-strong`, radius 10, padding 8 × 12, 14 px; focus = accent border + 3 px `--accent-soft` ring. Number inputs right-aligned in `--num`. Checkboxes and ranges use `accent-color`. |
| **Footer** `.foot` | 12.5 px muted note under the page; links in `--text-2`, underlined, `--text` on hover ("Buy me a coffee"). |
| **Toast** `.toast` | inverted, radius 12, bottom centre, 3.5 s, short plain English. |
| **Install hint** `.install-hint` | small card bottom right (full width on mobile): title "Run the app offline", one line of text, an "Install app" button (only where the browser exposes `beforeinstallprompt`) and a ✕ top right. Shown once, dismissals remembered per browser; hidden in the installed (standalone) view. No overlay, no shadow trap — the card sits above the content. |

### Builder-specific

| Component | Spec |
|---|---|
| **Choice card** `.choice` | plan-card pattern for single-choice options (mode, goal, style): card padding 16, hover lift 1 px and `--line-strong` border; selected = accent border + 1 px accent ring + round check badge top right. Title `h3`, text `--text-2` 13.5 px, optional art (mode) or mix bar (goal, style) at the bottom. |
| **Mix bar** `.zmix` | 6 px rounded bar in zone fills: which intensities a goal's key sessions use (Z3/Z4/Z5), or a style's easy/moderate/hard split (Z2/Z4/Z5). |
| **Form rows** `.frow` | label (+ muted hint) left, control right, 1 px divider between rows. |
| **Summary card** `.side` | "Your answers": `.stats` grid of `.k` label + 22 px value, a seven-day strip (`--accent-soft` = indoor, `--surface-3` = outdoor) and a meta line. Sticky at 76 px. |
| **Day tile** `.day` | resting: `--surface-2`, muted day name; riding: `--surface` with accent border and ring, a time stepper and an "Outdoor" toggle badge. The tile itself toggles rest / ride. |
| **Day stepper** `.stepper` | duration on its own line (19 px `--num`, 650, "1h30"; full duration as `title`), below it a compact pill `.steps` (`--surface-2`, 1 px `--line-strong`, radius 99) with − / + halves (30 × 24, divider `--line`, `--surface-3` on hover). 15-minute steps; − is disabled at 30 min, + at 5 h. Stays inside the tile down to 390 px. |
| **Volume bar** `.pbar` | 6 px track, accent fill for available time, a 2 px `--text` marker for current hours. |
| **Weekly load chart** `.lbars` | one bar per week: accent = build, 35 % accent = recovery, `--line-strong` = taper; target as a thin `--text` line at 50 % opacity; value above; week number and phase as text below. |
| **Option card** `.opt` | single-workout option: eyebrow "Option n" + zone tag, title, 64 px profile on `--surface-2`, meta, small download buttons. The card opens the dialog. |

## Icons

Inline SVG, 24 × 24 viewBox, `stroke="currentColor"`, `stroke-width="2"`, round caps and
joins (Lucide-like); the gear is zwoTrainer's filled glyph. 20 px in the top bar, 16 px in
buttons.

The app icon is `src/app/icon.svg` (black rounded tile with rising bars in the zone fills).
`build-app.mjs` strips its XML prolog and metadata, inlines it in the top bar
(`aria-hidden`, 26 px) and embeds it as an SVG data-URI favicon. Edit only that file; the
icon's colours are the one place where literal hex values are allowed. The PWA icons are
PNGs generated from the same SVG into `src/app/icons.json` (`any` at 192/512/1024,
`maskable` scaled to 82 % inside the square) — regenerate them when the icon changes.

## Offline and install (PWA)

The app is one self-contained HTML file, so "offline" mostly means it keeps working when
the network drops: on the web a service worker (`sw.js`, cached shell = the page itself,
manifest and icons) caches it, and the install hint card offers to add it to the home
screen. Both activate only where the PWA assets are served next to the page — a plain
`file://` copy still opens and works, just without the cache and the hint.

## Interaction rules

- One primary action per view or dialog, always last (right).
- Validation: the primary button is disabled and the reason shows on the left of the action
  row ("Pick at least one day.").
- Feedback: toasts for downloads and swaps; inline text for validation.
- Motion: 150 ms for hover, border and opacity; 1 px lift on hover for cards; no bounces.
  Everything is disabled under `prefers-reduced-motion`.
- Text: plain, friendly English in sentence case. Units with a space ("250 W", "90 %"),
  durations as `m:ss` / `h:mm:ss` (`fmtTime`) or "1h 05m" / "45 min" (`fmtDur`); day tiles
  use the short "1h30".
- Never mention the workout library, its coaches or plan names in the UI or in generated
  names and descriptions.

## Accessibility

- Icon-only buttons have `title` and `aria-label`.
- Selection is never shown by colour alone: check badge, ring, filled number or
  `aria-pressed`; the current step has `aria-current="step"`.
- Text contrast ≥ 4.5:1; coloured text uses the zone ink tokens.
- Everything is reachable by keyboard; rows and option cards are focusable and open with
  Enter or Space; Esc closes the dialog and the popover.

## Checklist for UI changes

- [ ] Only tokens and zone colours; no new raw colours.
- [ ] Same as zwoTrainer where a shared component exists; new patterns documented here.
- [ ] Mobile first: base rules for phones, wider layouts in `min-width` queries, compact sizes only under `(pointer: fine)`.
- [ ] Checked in light **and** dark, at 1280, 768, 390 and 320 px; touch targets ≥ 44 px.
- [ ] Top bar unchanged (brand · zwoTrainer · GitHub · coffee · Settings); new options in the Settings popover.
- [ ] Profile text is HTML, never stretched SVG text.
- [ ] Interpolated text is escaped with `esc()`.
- [ ] README / DESIGN.md updated if the change is user-visible or adds a pattern.
