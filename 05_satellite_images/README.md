# 05 — Imágenes Satelitales — Clasificación de Cobertura Terrestre

Aplicación web que lleva el flujo del notebook `actividad.ipynb` a una interfaz interactiva. Consulta imágenes **Sentinel-2 L2A** del catálogo STAC de Microsoft Planetary Computer, descarga 9 bandas espectrales y la máscara de nubes (SCL), calcula 7 índices, entrena un clasificador **Random Forest** con pseudo-etiquetado y genera un mapa de cobertura terrestre (Vegetación / Agua / Minería / Sin datos). Permite comparar la zona con cualquier año de la última década, calcular la serie temporal completa con tendencias y exportar un reporte.

---

## 🏗️ Arquitectura

```
05_satellite_images/
├── backend/              # FastAPI — puerto 8004
│   ├── main.py
│   ├── session_store.py  # Sesiones en memoria (TTL 60 min) + búsquedas de escenas (TTL 30 min)
│   ├── requirements.txt
│   ├── core/
│   │   ├── sentinel.py   # Lectura de assets, DN → reflectancia, máscara SCL, grillas
│   │   ├── search.py     # Búsqueda STAC + ranking por nubes dentro del bbox
│   │   ├── bands.py      # Descarga paralela alineada a B04 + True Color Preview
│   │   ├── indices.py    # NDVI, BSI, NDWI, MNDWI, NDBI, EVI, SAVI
│   │   ├── classifier.py # Pseudo-etiquetado, Random Forest y métricas hold-out
│   │   ├── compare.py    # Comparativa por año, serie temporal, capas para el mapa
│   │   ├── export.py     # PNG clasificado + GeoTIFF
│   │   └── report.py     # Reporte HTML, CSV de superficies, GeoJSON de cambios
│   └── routers/          # search, bands, indices, classifier, export, compare
├── frontend/             # React + TypeScript + Vite + Tailwind + Leaflet + Recharts — puerto 5177
│   └── src/
│       ├── components/
│       │   ├── SearchPanel.tsx      # Paso 1: zona en el mapa + selector de escenas
│       │   ├── ScenePicker.tsx      #   miniaturas con nubosidad local
│       │   ├── BandsPanel.tsx       # Paso 2: descargar bandas
│       │   ├── IndicesPanel.tsx     # Paso 3: explorar índices
│       │   ├── ClassifierPanel.tsx  # Paso 4: entrenar y predecir
│       │   ├── ClassifierMetrics.tsx#   matriz de confusión + importancia de variables
│       │   ├── MapPanel.tsx         # Paso 5: mapa interactivo y exportación
│       │   ├── ComparePanel.tsx     # Paso 6: comparativa de un año (slider antes/después)
│       │   ├── TimeSeriesPanel.tsx  #   serie de 10 años con tendencias
│       │   └── map/                 # AoiMap, SwipeMap, LayerControls, capas base
│       ├── hooks/                   # useProgressStream (NDJSON), useLayerBounds
│       └── lib/                     # zonas de ejemplo, colores de gráficos
├── satellite_analyzer.ipynb  # Notebook de referencia (no modificar)
└── run.sh                    # Script de arranque unificado
```

## 🚀 Ejecución rápida

```bash
cd 05_satellite_images
bash run.sh
```

- **Frontend:** http://localhost:5177
- **Backend API:** http://localhost:8004
- **Docs API:** http://localhost:8004/docs

## 🔧 Ejecución manual

### Backend
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8004 --reload
```

### Frontend
```bash
cd frontend
npm install && npm run dev
```

## 🧭 Dos modos

- **Guiado** (para periodistas y no especialistas): eliges una zona de Colombia y un solo botón ejecuta todo el análisis (escena más despejada del último año → bandas → modelo con las reglas por defecto → mapa → serie de 10 años). El resultado es una frase con la tendencia de la vegetación, su intervalo de confianza y su significancia; un mapa antes/después; el gráfico de hectáreas por año; las descargas listas para publicar (imagen antes/después y gráfico de tendencia con el crédito de Copernicus, CSV, reporte) y un recuadro con lo que la herramienta mide y lo que no.
- **Experto**: los 6 pasos con todos los parámetros. La sesión es la misma: «Ver el análisis completo» abre en modo experto lo calculado en modo guiado.

El selector está arriba del riel lateral y se recuerda en el navegador.

## 🎨 Diseño

Mundo visual «pliego de herbario» (tradición del Herbario Nacional Colombiano): cartón de montaje gris verdoso, papel de etiqueta, tinta ferrogálica, riel verde carpeta, violeta de sello de accesión para las acciones y un rojo reservado solo para el cambio estadísticamente significativo. Cada zona analizada lleva su **etiqueta de ejemplar** (localidad, coordenadas, fecha, satélite, nubes, cobertura por clase) y cada año comparado le agrega una **ficha de determinación** fechada. Tipografías autoalojadas: Atkinson Hyperlegible Next (interfaz), Source Serif 4 (títulos y localidades) y Courier Prime (cifras). Paletas de clases y de cambios validadas para daltonismo. Contexto de producto en `PRODUCT.md`.

## 🗺️ Flujo de la Aplicación (6 pasos)

### Paso 1 — Zona y escena
La app está enfocada en **Colombia**: el mapa (Leaflet + Esri World Imagery) resalta el país y oscurece el resto, no permite alejarse fuera de él y el buscador (Nominatim) solo devuelve lugares colombianos. El backend rechaza zonas fuera del territorio (`core/region.py`, contorno de Natural Earth en `backend/resources/colombia.geojson`, incluye San Andrés, Providencia y Malpelo; `GET /region`). Zonas de ejemplo: El Bagre, Río Quito, Hidroituango, Cerrejón, San José del Guaviare, Ciénaga Grande. Máximo 500 km².
`POST /scenes` lista hasta 12 escenas ordenadas por **nubosidad dentro de la zona**, medida con la capa SCL a baja resolución (la `eo:cloud_cover` del catálogo es la del tile completo de 110 × 110 km y suele engañar). Cada escena trae una miniatura recortada a la zona (`GET /scenes/thumbnail`). La escena elegida crea la sesión (`POST /search` con `search_id` + `scene_id`).

### Paso 2 — Descarga de Bandas
B04 se lee en su ventana nativa (10 m) y define la grilla; las demás bandas (B02, B03, B05, B06, B07, B08, B11, B12) y la **SCL** se leen **en paralelo** reproyectadas sobre esa grilla (`WarpedVRT`). Los DN se convierten a **reflectancia de superficie**: `ρ = (DN − offset) / 10000`, con `offset = 1000` desde el processing baseline 04.00 (enero 2022). Los píxeles con nube, sombra, cirros o nieve se enmascaran.

### Paso 3 — Índices Espectrales

| Índice | Fórmula | Detecta |
|--------|---------|---------|
| NDVI | `(B08−B04)/(B08+B04)` | Vegetación |
| BSI | `((B11+B04)−(B08+B02))/((B11+B04)+(B08+B02))` | Suelo desnudo |
| NDWI | `(B03−B08)/(B03+B08)` | Agua |
| MNDWI | `(B03−B11)/(B03+B11)` | Agua (sin confundir con suelo urbano) |
| NDBI | `(B11−B08)/(B11+B08)` | Áreas construidas |
| EVI | `2.5(B08−B04)/(B08+6B04−7.5B02+1)` | Vegetación densa (no se satura) |
| SAVI | `1.5(B08−B04)/(B08+B04+0.5)` | Vegetación con suelo visible |

### Paso 4 — Clasificador Random Forest
Pseudo-etiquetado con umbrales (abajo): un píxel se etiqueta solo si cumple **exactamente una** regla; los que cumplen varias (p. ej. ríos con sedimento, que son "agua" y "suelo" a la vez) se descartan como ambiguos. Submuestreo **proporcional** estratificado (≤ 60 000 muestras, conservando la proporción real de cada clase con un mínimo de 1 000 para clases raras), partición hold-out estratificada 75/25 y `RandomForestClassifier(n_estimators=150)` sobre **16 variables** (7 índices + 9 bandas). Se reportan exactitud, kappa de Cohen, OOB, matriz de confusión, precisión/recall por clase e importancia de variables. La validación mide el acuerdo con las pseudo-etiquetas, no con datos de campo.

```
Vegetación : NDVI > 0.60  AND BSI  < -0.10
Agua        : NDWI > 0.10  AND NDVI < 0.10
Minería     : BSI  > 0.12  AND NDVI < 0.25
```

### Paso 5 — Mapa Clasificado
Capa de clasificación, NDVI o color real superpuesta al mapa satelital con opacidad ajustable (`GET /layer`, `GET /layer/bounds`). Exportación: **reporte HTML** imprimible a PDF, **CSV** de superficies, **PNG** y **GeoTIFF**.

### Paso 6 — Comparativa Temporal
- **Un año** (`POST /compare`): escena de la misma temporada (±60 días; si no hay, todo el año) con menos nubes en la zona, alineada píxel a píxel y clasificada con el **mismo** modelo. Slider **antes/después** sobre el mapa (color real, clasificación, NDVI o mapa de cambios), figura comparativa, superficies y transiciones (p. ej. vegetación → minería) y **GeoJSON** de polígonos de cambio (`GET /export/changes.geojson`, manchas < 0.5 ha filtradas).
- **Serie de 10 años** (`POST /timeseries`): procesa los años en paralelo y estima la tendencia de cada clase sobre el % del área sin nubes (solo años con ≥ 50 % de la zona despejada) con la **pendiente de Theil-Sen** (mediana de pendientes entre pares de años, robusta frente a años atípicos, con IC 95 %) y la **prueba de Mann-Kendall** (p-valor; significativa si p < 0.05). Sentinel-2 L2A tiene cobertura irregular antes de 2017.

### Salidas para publicar
- `GET /export/beforeafter.png?year=…&kind=rgb|class&title=…` — antes/después con fechas, barra de escala y crédito «Contiene datos modificados de Copernicus Sentinel-2».
- `GET /export/trend.png?title=…` — hectáreas de vegetación por año con la recta de Theil-Sen, el veredicto de Mann-Kendall y el IC 95 %; eje desde cero para no exagerar cambios pequeños.
- Los años con menos del 50 % de píxeles clasificados no entran en la tendencia y aparecen como huecos (nunca como 0).

## 🔑 Conceptos Clave

### ¿Por qué funciona con una sola imagen?
El modelo no necesita datos de entrenamiento externos. Usa **pseudo-etiquetado**: aplica reglas físicas conocidas (propiedades espectrales de vegetación, agua y suelo) para etiquetar automáticamente los píxeles más "puros" de la propia imagen. El Random Forest luego generaliza esas reglas a los píxeles ambiguos.

### Sesiones en memoria
Cada búsqueda crea una sesión con TTL de 60 minutos que almacena las bandas descargadas, los índices calculados, el clasificador entrenado y el mapa resultante. Esto evita re-descargas entre pasos.

### Streaming NDJSON
Las operaciones largas (descarga, entrenamiento, predicción, comparativa, serie temporal) transmiten su progreso como `application/x-ndjson` con líneas `{stage, progress, message}`. Las tareas en segundo plano emiten un latido cada ~8 s para que el cliente no corte la conexión por silencio (30 s).

### Comparabilidad entre años
Para que un cambio en el mapa sea un cambio real en el terreno: misma temporada fenológica, misma grilla (reproyección directa), misma escala radiométrica (reflectancia con el offset propio de cada escena), mismo modelo y nubes excluidas. Las superficies se expresan también como % del área despejada para que la nubosidad de cada año no sesgue la tendencia.

## 🛠️ Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Python 3, FastAPI, rasterio, pystac-client, planetary-computer, scikit-learn, numpy, matplotlib |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Leaflet (react-leaflet), Recharts, lucide-react, Fontsource |
| Datos | Sentinel-2 L2A via Microsoft Planetary Computer STAC |
| ML | RandomForestClassifier (scikit-learn) |
| Exportación | GeoTIFF (rasterio), PNG (matplotlib), GeoJSON (rasterio.features), HTML, CSV |

## 📦 Dependencias del Backend

```
fastapi
uvicorn
pydantic
numpy
scipy
rasterio
pystac-client
planetary-computer
scikit-learn
matplotlib
python-multipart
```
