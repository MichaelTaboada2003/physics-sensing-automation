---
version: 1
slug: "frontend-src-app-tsx"
primary_target: "frontend/src/App.tsx"
related_targets: []
---

# Surface brief — App 05 (aplicación completa)

Scope: the whole single-page app (6 expert steps + guided mode). Mode: **Operate**.
Audience/job: the analyst runs the full pipeline; the journalist picks a Colombian zone and takes away before/after images, a trend chart and figures with uncertainty about vegetation loss (deforestation).
Constraints: Spanish, laptop + phone, light theme (daylight classroom/newsroom and outdoor phone use), real data only, every figure with its uncertainty, Copernicus credit on exported imagery.
Memorable moment: the specimen label with dated determination slips stacking one per year.
Unresolved: forest vs pasture distinction (see PRODUCT.md); guided mode must label "Vegetación" honestly until then.

## Direction contract

THESIS: Every analysed zone is a herbarium specimen of the Herbario Nacional Colombiano tradition: a sheet with a typed label (locality, coordinates, collection date, collector) and dated determination slips added year by year without erasing earlier ones. Refuses the category default: dark GIS dashboard with neon accent and glass cards.

OWN-WORLD: Light archival grey-green mounting board ground (#EEF1EA), near-white label paper surfaces (#FBFCF8), iron-gall blue-black ink (#1B2430), deep genus-folder green rail (#1E3A2B) as the committed shell, accession-stamp violet (#5A4A9C) for action/selection/focus, type-specimen red (#B42318) reserved for significant change and vegetation loss only. Class data: vegetation #16A34A, water #2563EB, soil/mining #B45309. Type: Atkinson Hyperlegible Next for UI, Source Serif 4 for headings with italic for place names, Courier Prime for every figure, coordinate and identifier (tabular, decimal-aligned). 1px hairline rules #CDD3C8, 6px radii, offset soft shadows only on floating label/sheet.

STORY: The visitor sees where they are (step rail), picks a place in Colombia on the map, and every result lands on the same specimen label; comparisons add dated slips, and only statistically significant change wears the red stamp. The journalist gets the same truth through the guided mode in plain Spanish.

FIRST VIEWPORT: Desktop: 248px folder-green rail at left (app name, Guiado/Experto switch, six numbered steps with done/current/locked states, session summary at the bottom). Work area: step header (serif title, one-line purpose, primary action right-aligned), then the map filling the remaining height with the AOI drawn; zone presets as a horizontal list above the map; the specimen label floats bottom-right over the map once a zone exists. Mobile: top bar with step name, map full-screen, step content in a bottom sheet.

FORM: Pliego de herbario (Herbario Nacional Colombiano / Expedición Botánica), position 5 of 7 on the ordered list, seed key ad33e8b6. Signature move: the specimen label with stacked yearly determination slips. Raises: tabular mono figures (Ikeda), one reserved significance colour held until seen (gate board), map-only mobile with bottom sheet (feed), coordinate graticule as a real toggle (Crouwel).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Cited adaptations (after finish review, 2026-10-09)

- Zone presets: on desktop a vertical list in the right column beside the map (each preset needs its one-line description, which a horizontal row truncates); on mobile a horizontal scrollable row above the map, followed by the primary action, so a zone is chosen before the action names it.
- Mobile first viewport: no bottom sheet. The rail collapses to one row (name + Guiado/Experto) plus a scrollable step row; step content stacks under the header and the map keeps 360px. Chosen so the map's drag and the swipe divider have no competing sheet gesture (a design rationale, not a tested comparison).
- Primary actions sit at the end of the column they complete (zone column, rule sheet), not in the step header: the action follows the inputs it depends on.
