---
name: Imágenes Satelitales · Cobertura terrestre Colombia
description: Sentinel-2 land-cover change for Colombia, recorded as a herbarium sheet with dated determination slips.
colors:
  ground: "#eef1ea"
  paper: "#fbfcf8"
  paper-2: "#f4f6f0"
  ink: "#1b2430"
  ink-2: "#3d4856"
  muted: "#5f6b77"
  rule: "#cdd3c8"
  rule-strong: "#aab3a6"
  folder: "#1e3a2b"
  folder-2: "#2a4c39"
  folder-ink: "#e3ebe2"
  folder-muted: "#a9bdaf"
  stamp: "#5a4a9c"
  stamp-2: "#4a3c86"
  stamp-tint: "#ecebf6"
  signal: "#b42318"
  signal-tint: "#fbeae8"
  veg: "#16a34a"
  veg-ink: "#15803d"
  water: "#2563eb"
  soil: "#b45309"
  gain: "#0d9488"
  other: "#7c3aed"
  newsoil: "#f59e0b"
  map-ground: "#d9ded3"
typography:
  display:
    fontFamily: "Source Serif 4 Variable, ui-serif, Georgia, serif"
    fontSize: "2.375rem"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.012em"
  lede:
    fontFamily: "Source Serif 4 Variable, ui-serif, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1.24
    letterSpacing: "-0.008em"
  headline:
    fontFamily: "Source Serif 4 Variable, ui-serif, Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
  place-name:
    fontFamily: "Source Serif 4 Variable, ui-serif, Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.375
  body:
    fontFamily: "Atkinson Hyperlegible Next Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Atkinson Hyperlegible Next Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.5
  figure:
    fontFamily: "Courier Prime, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    letterSpacing: "0"
    fontFeature: "tnum"
rounded:
  swatch: "2px"
  inner: "3px"
  control: "4px"
  group: "5px"
  sheet: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.stamp}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.stamp-2}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  button-quiet:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "44px"
  button-quiet-hover:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  sheet:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.sheet}"
    padding: "16px"
  segmented:
    backgroundColor: "{colors.paper-2}"
    rounded: "{rounded.group}"
    padding: "3px"
  segmented-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.inner}"
  rail:
    backgroundColor: "{colors.folder}"
    textColor: "{colors.folder-ink}"
    width: "248px"
  specimen-label:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    width: "300px"
  stamp:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "9px 16px 8px"
  stamp-significant:
    textColor: "{colors.signal}"
  year-slip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 8px 8px"
---

# Design System: Imágenes Satelitales · Cobertura terrestre Colombia

## Overview

**Creative North Star: "Pliego de herbario"**

Every analysed zone is treated as a specimen of the Herbario Nacional Colombiano tradition: a mounting sheet with a typed label (locality, coordinates, collection date, collector) and dated determination slips added year after year without erasing the earlier ones. The interface is a light archival workroom: grey-green mounting board as the ground, near-white label paper for every working block, iron-gall ink for text, and a deep genus-folder green rail that holds the steps. It deliberately refuses the category default of the dark GIS dashboard with neon accent and glass cards.

Density is that of an instrument, not a brochure: hairline-ruled sheets, tabular monospace figures, data tables, and the map as the dominant surface. Colour is spent on meaning. Violet is the hand of the archivist (action, selection, focus); the three class colours are the data; type-specimen red is the alarm. Everything else is paper, ink and rule.

Since the November 2026 pass the materials are present, not just named: the board carries a faint fibre, every sheet a paper grain, the rail is woven folder linen with a paper label glued on, and the trend verdict is a rubber stamp with uneven ink. All of it is inline SVG noise in iron-gall ink at very low opacity; nothing is a photograph and nothing costs a request.

Motion is small and physical: blocks settle up 6px into place, and determination slips drop onto the label with a slight rotation as if laid by hand. One moment is choreographed: when the guided results arrive, the determination stamp drops, presses and stays. It happens once per analysis. All motion collapses under reduced-motion.

**Key Characteristics:**
- Light theme only: mounting-board ground, label-paper sheets, iron-gall ink.
- Folder-green linen rail as the committed shell, with a paper label for the app name and the current step as a tab that opens onto the sheet; violet stamp for every interactive selection.
- The verdict of a trend is a determination stamp; the timeline of years is a row of determination slips.
- Three-voice type: humanist sans for UI, serif for titles and italic place names, typewriter mono for every figure.
- Hairline 1px rules and small radii (2 to 6px); soft shadow only on floating objects.
- Colour-blind-validated class and change palettes, always paired with a text label.
- Spanish (es-CO) number formatting everywhere: decimal comma, period thousands separator.

## Colors

A restrained archival palette of paper and ink, one violet action colour, one reserved red, and two small categorical palettes for data.

### Primary
- **Accession-Stamp Violet** (stamp): the only action colour. Primary buttons, `accent-color`, caret, text selection, focus outline, selected preset rows (on stamp-tint), progress fill while running, the selected scene ring. Hover deepens to **Pressed Stamp** (stamp-2), which also carries violet text links (7.0:1 and 8.9:1 on paper).
- **Stamp Tint** (stamp-tint): background of a selected list row and the 3px focus halo of fields.

### Secondary
- **Genus-Folder Green** (folder): the step rail and its mobile top bar. Raised parts of the rail (mode switch track, session box border) use **Folder Fold** (folder-2). Text on the rail is **Folder Ink** (10.2:1) and secondary rail text **Folder Grey-Green** (6.2:1).

### Tertiary
- **Type-Specimen Red** (signal) with **Red Wash** (signal-tint): vegetation loss on maps, charts and difference tables; a statistically significant trend verdict and its stamp on the specimen label; and, in the build, error and invalid-input messages.

### Data: land-cover classes
- **Vegetation Green** (veg): class swatches, chart strokes, completed-progress and done icons. At 3.2:1 on paper it is a graphic colour, not a text colour.
- **Vegetation Ink** (veg-ink): green used as text (4.87:1 on paper), e.g. the V figure on determination slips.
- **Water Blue** (water) and **Exposed-Soil Ochre** (soil): class swatches and strokes; both pass 4.5:1 as text on paper.
- Shared verbatim by the frontend (`lib/colors.ts`, theme tokens) and backend rasters (`CLASS_COLORS`, with ink for unclassified/cloud). Simulated under protanopia, deuteranopia and tritanopia the closest pair stays at ΔE ≥ 20.

### Data: change map
- **Loss** uses Type-Specimen Red; **Regrowth Teal** (gain), **Other-Change Violet** (other) and **New-Soil Amber** (newsoil) complete the set. Backend `CHANGE_LABELS` uses the same four values, map-ground for no change and ink for no data. All pairs keep ΔE ≥ 40 under the three CVD simulations. Amber (2.1:1) and teal (3.6:1) are swatch-only colours, never text.

### Neutral
- **Mounting Board** (ground): page background.
- **Label Paper** (paper): every sheet, field, label and slip. **Resting Paper** (paper-2): segmented tracks, quiet hovers, alternate fills.
- **Iron-Gall Ink** (ink, 15.2:1), **Faded Ink** (ink-2, 9.0:1) for secondary text and labels, **Pencil Note** (muted, 5.3:1) for notes and hints.
- **Hairline** (rule) for 1px dividers and sheet borders; **Strong Hairline** (rule-strong) for field and control borders, table header rules and scrollbars.
- **Map Board** (map-ground): Leaflet background and the "no change" class in change rasters.

### Named Rules
**The Reserved Red Rule.** Red marks vegetation loss, statistical significance and errors that block the user; nothing decorative ever wears it. A trend that is not significant is drawn in muted grey, never red, in the app and in the exported PNG alike.

**The Named Swatch Rule.** No class or change colour appears without its Spanish label beside it (legends, slips, chart legends, PNG legends). Identity is never colour-alone.

**The Green-Text Rule.** Green text uses veg-ink; veg is reserved for strokes, swatches and icons.

## Typography

**Display Font:** Source Serif 4 Variable (with ui-serif, Georgia)
**Body Font:** Atkinson Hyperlegible Next Variable (with ui-sans-serif, system-ui)
**Label/Mono Font:** Courier Prime 400/700 (with ui-monospace, Menlo)

All three are self-hosted through @fontsource packages imported at the top of the stylesheet; no font CDN is used.

**Character:** A legibility-first humanist sans does the work; a scholarly optical-size serif gives titles and place names the voice of a herbarium sheet; a typewriter mono makes every number look typed onto the label.

### Hierarchy
- **Display** (serif 600, 2rem, 2.375rem from 640px, 2.75rem from 1280px, leading 1.12, tracking -0.012em): the step title in the work-area header. In guided results it names the place ("Qué cambió en San José del Guaviare"). The app name on the folder label runs at 1.3125rem.
- **Lede** (serif 400, 1.625rem, 2rem from 640px, 2.375rem from 1280px, leading 1.2 to 1.24, max 46rem): the guided-mode finding, the sentence a journalist can quote. Its figures are mono at 0.86em; only a significant loss turns red.
- **Headline** (serif 600, 1.25rem): section titles inside a step and chart titles.
- **Place Name** (serif italic 400, 1.125rem): zone names on the specimen label.
- **Body** (sans 400, 1rem, 1.5): purpose lines (max 65ch) and prose; 0.875rem in tables and secondary lines.
- **Label** (sans 600, 0.8125rem, ink-2): field labels, table headers, slip headers. Sentence case; no uppercase or tracked labels anywhere.
- **Figure** (mono, tabular numerals, 0 tracking): every value, coordinate, date, percentage, p-value, tile and scene identifier; right-aligned in tables.

### Named Rules
**The Typed Figure Rule.** If it is a number, coordinate, date or identifier, it is set in the mono figure style with tabular numerals and es-CO formatting (decimal comma, e.g. "12,5 %", "p < 0,001"), and a missing value is an em dash.

**The Italic Locality Rule.** Serif italic is reserved for place names on the label; it is not used for emphasis.

## Layout

Desktop (from 1024px): a two-column grid with a 248px sticky full-height folder rail on the left (app name, Guiado/Experto switch, numbered steps with done/current/locked states, session summary at the bottom) and the work area on the right, padded 40px horizontally and 32px vertically. The work area opens with the step header (serif title, one-line purpose), then the step content at max 1152px. When a zone exists and the viewport is 1280px or wider, a 300px right column holds the sticky specimen label beside the content (max 1400px). Guided zone choice uses a main column plus a 320px right column with the vertical preset list and the primary action at its foot.

Mobile and tablet: the rail collapses into a top bar (name and mode switch) plus a horizontally scrolling step row; content stacks with 16px gutters (24px from 640px); zone presets become a horizontal snap-scrolling row of 208px cards above the map; the map keeps its own fixed height and no bottom sheet competes with its gestures.

Rhythm: 4px base. Sheets pad 16px; stacks use 12/16/20/24px gaps; step sections separate by 32px in guided results. Primary actions sit at the end of the column whose inputs they complete, not in the header.

Breakpoints are Tailwind defaults: 640px, 1024px, 1280px.

## Elevation & Depth

The system is flat paper on board: sheets and tables are separated by 1px hairlines and the tonal step from ground to paper, with no shadow. Shadows exist only for objects that float over the map or over other paper, and they are soft, ink-tinted and offset downward like a sheet resting on a table.

The folder label is the one object glued rather than floating: `box-shadow: 0 1px 0 rgb(0 0 0 / 0.25), 0 8px 18px -10px rgb(0 0 0 / 0.55)` on the linen.

### Shadow Vocabulary
- **Sheet** (`box-shadow: 0 1px 2px rgb(27 36 48 / 0.06), 0 6px 18px -6px rgb(27 36 48 / 0.18)`): map controls, before/after year tags on the swipe map.
- **Lift** (`box-shadow: 0 2px 4px rgb(27 36 48 / 0.08), 0 14px 32px -10px rgb(27 36 48 / 0.32)`): the specimen label and the swipe-divider handle.
- **Slip** (`box-shadow: 0 1px 2px rgb(27 36 48 / 0.08)`): each determination slip stacked on the label.
- **Pressed tab** (`box-shadow: 0 1px 2px rgb(27 36 48 / 0.12)`): the selected segment of a segmented control.

### Named Rules
**The Floating-Only Shadow Rule.** A shadow means the object floats over the map or over another sheet. Sheets in the document flow are bordered, never shadowed.

## Shapes

Small, near-square corners, like cut card stock: 6px for sheets, 5px for grouped controls and rail items, 4px for buttons, fields and the label, 3px for inner segments and chips, 2px for colour swatches and graticule tags. Step numbers sit in full circles. Borders are 1px throughout; the only 2px strokes are the focus outline and the selected-scene ring, both violet. Slips have rounded tops only and overlap the label by 4px, each indented 6px further than the one above.

## Components

### Buttons
Firm and plain, like a rubber stamp: weight does the work, not decoration.
- **Shape:** gently squared (4px), min height 44px, 18px side padding, 700 weight, 0.9375rem, optional 16px lucide icon with 8px gap.
- **Primary:** stamp violet with white text; hover stamp-2. One per column, at its end.
- **Secondary:** paper with ink text and a strong-hairline border; hover darkens the border to ink-2 and lifts the fill to white.
- **Quiet:** ink-2 text, 10px padding; hover paper-2 fill and ink text.
- **States:** press nudges down 1px; disabled is 50% opacity with not-allowed cursor; focus is the global 2px violet outline at 2px offset.

### Segmented control
- **Style:** paper-2 track, 1px rule border, 3px padding, 2px gaps, 5px radius; segments 0.875rem 600 in ink-2.
- **State:** selected segment turns paper with ink text and the pressed-tab shadow (via `aria-pressed` or `aria-selected`). The rail's mode switch is the same pattern on folder-2.

### Cards / Containers (sheets)
- **Corner Style:** 6px.
- **Background:** label paper on the mounting-board ground.
- **Shadow Strategy:** none (see Floating-Only Shadow Rule).
- **Border:** 1px hairline; internal divisions are hairline `divide` rules.
- **Internal Padding:** 16px; metric strips use 12px by 16px cells.

### Inputs / Fields
- **Style:** paper fill, 1px strong-hairline border, 4px radius, 8px by 12px padding, 0.9375rem; muted placeholder.
- **Focus:** border turns stamp violet with a 3px stamp-tint halo.
- **Error:** border turns signal red (`aria-invalid`), with a red message line beneath.
- **Field label:** 0.8125rem 600 ink-2, sentence case, above the field.

### Navigation (step rail)
- **Style:** folder-green linen (two 3px repeating gradients over the green, darker toward the spine and the edge), folder-ink text. The app name sits on a paper label glued at the top, with "Cobertura terrestre · *Colombia*" under a hairline. Each step is a 5px-radius row with a 28px circular mono number (check icon once done), 0.9375rem 600 label; locked steps show a lock icon and are not focusable targets.
- **Current step:** a board-coloured tab that runs to the rail's right edge with square right corners, so the step visibly opens onto the work area.
- **Session slip:** at the foot of the rail, the place name in serif italic, the scene date and, with annual composites, how many scenes vote each year.
- **Mobile:** collapses into a top bar and a horizontally scrolling row of the same step pills.

### Data table
- **Style:** 0.875rem; headers 0.8125rem 600 ink-2 over a strong hairline; rows ruled by hairlines, last row open; numeric cells right-aligned mono figures.

### Charts
- **Style:** Recharts line charts inside sheets, with figcaption title and muted unit line; horizontal grid only; class strokes 2px with paper-ringed dots; legends in ink-2.
- **Trend chart (`TrendChart`):** hand-built SVG for the main class in hectares: 2.25px class stroke, paper-ringed dots, Theil-Sen dashed line and 95 % band (red only if significant, otherwise muted grey), excluded years as hollow dashed marks on the axis. The year in focus gets a dotted cursor, a 6px dot and its value typed on a paper tag; clicking a year moves the timeline to it.
- **Axis:** the trend chart starts at zero by default. A two-segment switch offers "Acercar", which crops the axis, draws an axis-break mark at its foot and prints "Eje recortado (no parte de cero)…" in soil ochre under the chart. The exported PNG always starts at zero.
- **Rules:** class-share charts run on a fixed 0 to 100 % axis, and the exported vegetation trend PNG starts its axis at zero. Years excluded from the trend are null and drawn as gaps (`connectNulls={false}`, NaN in matplotlib), never as zero. The NDVI panel uses an automatic domain because NDVI is a signed index.

### Specimen label (signature)
A 300px floating label: serif italic place name, DMS coordinates in mono, a hairline-ruled definition list (area, date, satellite, tile, local cloud) with right-aligned figures, the class determination with 10px named swatches, and the vegetation-trend stamp, which is red on red wash only when the trend is significant and paper-2 with ink-2 otherwise. Above it, up to four dated determination slips stack newest on top, each a paper strip with "Det. YYYY", the scene date and V/A/S percentages in their class inks; older slips are counted beneath. The label collapses to its header on small maps.

### Determination stamp (signature)
The Mann-Kendall verdict as a rubber stamp: serif 700 at 1.1875rem over a 0.875rem line with the p-value and the period, 2px border plus a 1px outline at 2px offset (double rule), rotated -3°, sentence case. Ink is uneven through one shared SVG filter (`#ink-bleed`: turbulence displaces the edge by 1.3px and a low-frequency mask thins patches). Colour follows the Reserved Red Rule: signal red when significant, ink-2 otherwise; the words always say the same thing as the colour. A small version (0.8125rem) closes the specimen label beside the ha/yr figure. On arrival of the guided results it plays `stamp-press` once (0.62s after a 0.35s delay: from 1.7 scale at -11° down to 0.965, then rest).

### Timeline (year slips)
The timeline's control is a row of determination slips, one per year: paper strips with rounded tops, mono year (0.875rem 700) over the main class share (0.75rem). The visible year lifts 7px with the lift shadow and a violet border; hover lifts 2px; years outside the trend sit on paper-2 in muted ink and read "sin datos". Left and right arrows move between years; the row scrolls horizontally on phones. Beside it: the primary Reproducir/Pausar button, a 2× toggle and the GIF download. Over the map, a paper tag carries the year in mono 1.75rem 700, the main class in hectares and how the year was measured ("voto de 6 escenas"). Frames cross-fade in 0.38s with the previous year held underneath, so the base map never shows through.

### Year matrix (progress)
While a series runs, a sheet lists one row per year, newest first: mono year, one 14px square per scene, and the state at the right. Squares are outlined when pending, pulse violet-tint when next, fill violet when classified and turn vegetation ink when the year is done, at which point its main-class share is typed beside a green check. A year with no imagery reads "sin imágenes"; unplanned slots are dashed. The header counts scenes ("25 de 66").

### Swipe map and graticule
Before/after rasters render pixelated; a 2px paper divider with a lift-shadowed 36×48px handle (keyboard-operable with arrow keys) and mono year tags on sheet shadow. The graticule is a real toggle: thin meridians and parallels with mono decimal-comma degree labels on 85% paper tags.

### Task progress
A sheet with a status icon (violet spinner, green check or red alert), a plain-language title, the latest stream message, a 6px progress bar (violet while running, green when complete), and the technical log in a collapsed "Detalle técnico" disclosure using the system's own chevron.

### Publishable rasters
Exported before/after and trend PNGs sit on label paper with ink titles, muted secondary text, the shared class and change palettes, and the Copernicus credit ("Contiene datos modificados de Copernicus Sentinel-2 (años)") printed on the image.

## Do's and Don'ts

### Do:
- **Do** set every figure in Courier Prime with tabular numerals and es-CO formatting ("1.234,5 ha", "p = 0,009").
- **Do** pair every class or change colour with its Spanish label.
- **Do** use veg-ink (4.87:1) for green text and keep veg, gain and newsoil for strokes and swatches.
- **Do** reuse the exact class (veg, water, soil) and change (signal, gain, other, newsoil) values in both frontend and backend rasters.
- **Do** start quantity axes at zero and draw excluded years as gaps; a cropped axis is allowed only as the explicit "Acercar" view of the trend chart, with its axis-break mark and its warning line.
- **Do** keep textures as inline SVG noise in ink at very low opacity; the grain must disappear at arm's length.
- **Do** write stamps in sentence case and let their colour repeat what their words say.
- **Do** draw a non-significant trend in muted grey and say "Sin tendencia significativa".
- **Do** keep stamp violet as the single action and focus colour.
- **Do** load fonts from the @fontsource packages, never a CDN.

### Don't:
- **Don't** use type-specimen red for decoration, emphasis or a non-significant trend.
- **Don't** add a dark theme, neon accents or glass panels; the world is light paper.
- **Don't** shadow in-flow sheets; shadows belong to floating objects only.
- **Don't** play the stamp press more than once per analysis, or stamp anything that is not a statistical verdict.
- **Don't** add tape, torn edges, coffee rings or photographic paper; the material is fibre, grain, linen and ink, nothing else.
- **Don't** set uppercase tracked labels or kickers above titles; labels are sentence case.
- **Don't** connect a line across an excluded year or plot it as zero.
- **Don't** round sheets, controls or labels beyond 6px; only progress tracks, gradient keys and step numbers are fully rounded.
