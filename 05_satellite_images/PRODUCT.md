# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **The analyst (author).** A physics/engineering student who built the app for the university course "Sensado y Modelado de Sistemas Físicos". Runs the full technical pipeline, tunes thresholds, trains the classifier and checks its metrics. Works on a laptop.
- **The journalist.** A communications friend who wants to report on **deforestation in Colombia** for news stories. Not a remote-sensing expert. Needs to pick a place, see what changed over the last decade, and take away publishable evidence. Uses a laptop and a phone.

Both use the app in Spanish.

## Product Purpose

Turn free Sentinel-2 imagery into verifiable evidence of land-cover change in Colombia: choose a zone, classify its cover, and compare it with any year of the last decade. Success for the analyst is a methodologically sound result they can defend in class; success for the journalist is a before/after image, a trend chart and figures with their uncertainty that can go into a story without misrepresenting what the data supports.

## Positioning

A guided, Colombia-focused change-detection workflow that runs end to end on real satellite data in the browser and states the statistical weight of every trend (Theil-Sen slope, 95% CI, Mann-Kendall significance) instead of just drawing a line.

## Operating Context

- Two ways of working, confirmed by the user: a **guided mode** for the journalist (pick a zone → see results and changes) and the current **expert mode** for the analyst (all six steps and parameters).
- Expert workflow: zone and scene → band download → spectral indices → pseudo-labelling + Random Forest → classified map → temporal comparison / 10-year series → export.
- Runs locally: FastAPI backend (port 8004) + React/Vite frontend (port 5177), launched from `run.sh` or the hub's Bento Launcher.
- Processing times are real: scene search ~5 s, band download ~7 s, a 10-year series ~25–45 s.

## Capabilities and Constraints

- Data: Sentinel-2 L2A from Microsoft Planetary Computer; reliable coverage from 2017, irregular before.
- Region: any AOI worldwide (decision 2026-10-09, reverting the Colombia-only scope); Colombia stays the focus through Colombian example zones, a reference outline on the map and place search that lists Colombian matches first. AOI up to 500 km².
- Classes: rules scheme (Vegetación, Agua, Suelo expuesto / minería) or WorldCover scheme (Bosque, Agua, Suelo expuesto / minería, Urbano / construido, Pastos y cultivos), plus Sin datos / nube.
- Outputs today: before/after map slider, comparison figure, area tables in hectares, change polygons (GeoJSON), area CSV, printable HTML report.
- Journalist needs (confirmed): publishable before/after images, trend charts, and figures with their uncertainty.
- **Forest vs. pasture — resolved with WorldCover (2026-10-13).** Two training methods: course rules (3 classes) and ESA WorldCover 2021 labels (forest, water, bare soil/mining, urban, grass/crops). Guided mode uses WorldCover, so forest turned into pasture counts as forest loss. **Open:** with one scene per year the forest series is noisy (±~1,000 ha year to year in Guaviare), too noisy for slow losses that Impact Observatory detects (~-56 ha/yr); annual multi-scene composites are the next step.
- **Heat (2026-10-13).** Land surface temperature from Landsat 8/9 (Sentinel-2 has no thermal band): per-class temperature and warming of lost vs. kept forest (difference-in-differences, detrended, block-bootstrap CI). Surface temperature at ~10:30 a.m., not air temperature; thermal detail is ~100 m; from 2013.
- Validation is against pseudo-labels, not field data; any figure must be presented as an estimate.

## Evidence on Hand

- Real outputs reproduced on El Bagre (2016–2025): vegetation −93.6 ha/yr (p = 0.009), mining +42.7 ha/yr (p = 0.047), water not significant.
- Verified example zones: El Bagre, Río Quito, Hidroituango (river in 2017, reservoir in 2025), Cerrejón, San José del Guaviare, Ciénaga Grande.
- Imagery credit required on publication: "Contiene datos modificados de Copernicus Sentinel-2 [año]"; heat figures also credit Landsat 8/9 (USGS).
- Heat on San José del Guaviare 2017→2025: deforested pixels warmed +1.4 °C more than kept forest (95% CI 1.2–1.7 °C).
- No testimonials, users, publications or field validation exist; none may be implied.

## Product Principles

1. **Never overstate the evidence.** Every number travels with its uncertainty, its date and what it actually measures; non-significant changes are labelled as such.
2. **Two depths, one truth.** The guided mode simplifies the path, never the result: the journalist sees the same figures the analyst computed.
3. **Colombia first, not Colombia only.** Examples, search priority, language and defaults speak to Colombian geography; analysis works anywhere.
4. **Show the place.** The satellite image and the map are the primary evidence; tables and charts support them.
5. **Real time is part of the story.** Long steps must say what is happening and why it takes time.

## Accessibility & Inclusion

Spanish interface. Must work on phones as well as laptops (confirmed). Charts carry legends, labels and table views so identity is never colour-alone.
