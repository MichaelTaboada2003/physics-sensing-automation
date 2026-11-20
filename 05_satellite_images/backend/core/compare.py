"""
core/compare.py
---------------
Análisis temporal: comparativa de un año y serie de hasta 10 años.

Dos métodos, según ``session.scenes_per_year``:

**Una escena por año (1).** Búsqueda estacional: ±60 días alrededor de la misma
fecha del año objetivo (misma época fenológica), eligiendo la escena con menos
nubes *dentro del bbox* (SCL).  Si no hay escenas, se amplía al año completo.

**Compuesto anual (3, 6 o 10).** Las N escenas más despejadas de todo el año se
clasifican por separado con el mismo modelo y cada píxel recibe la clase con
mayor probabilidad media (voto de ``predict_proba``).  Un píxel deja de sumar
observaciones cuando tiene al menos 3 y su probabilidad media supera 0,8.  Así
una nube residual, una creciente o una quema puntual ya no deciden el año.
No se compone la reflectancia: un mosaico de medianas saca al clasificador del
dominio en que se entrenó y rinde peor que una sola escena.  El año actual se
compone igual (``session.current_composite``) para que todos los años se midan
con el mismo método.

En ambos:
- Alineación: cada banda se reproyecta (WarpedVRT) directamente sobre la grilla
  de la escena actual, de modo que los mapas son comparables píxel a píxel.
- Radiometría: los DN se convierten a reflectancia con el offset propio de cada
  escena (baseline 04.00 → +1000), así todos los años están en la misma escala.
- Nubes: los píxeles inválidos según la SCL quedan como "sin datos" (-1).
- Clasificación con el mismo Random Forest entrenado en la escena actual.
"""

from __future__ import annotations

import concurrent.futures
import io
import json
import queue
import threading
import time
from datetime import date, datetime, timedelta
from typing import Callable, Generator

import numpy as np
from fastapi import HTTPException
from rasterio.enums import Resampling
from scipy import ndimage, stats

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.colors import ListedColormap, to_rgba

from core.classifier import build_features
from core.classes import primary, scheme, scheme_json
from core.export import _class_map_to_index, class_palette
from core.indices import compute_all_indices, compute_indices
from core.search import best_scene, list_scenes
from core.worldcover import WORLDCOVER_YEAR
from core.sentinel import (
    BAND_SET,
    RGB_BANDS,
    SCL_ASSET,
    boa_offset,
    cloud_mask_from_scl,
    read_on_grid,
    to_reflectance,
)
from session_store import SessionData, get_session

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

MAX_YEARS_BACK = 10
SEASON_WINDOW_DAYS = 60
_HEARTBEAT_S = 8.0       # el frontend corta tras 30 s sin datos
_YEAR_WORKERS = 4        # años procesados en paralelo en la serie temporal
_BAND_WORKERS = 10       # las 9 bandas y la SCL de una escena a la vez

# Compuestos anuales por voto de probabilidades
COMPOSITE_CHOICES = (1, 3, 6, 10)   # escenas por año que acepta la API
VOTE_MIN_OBS = 3                    # observaciones mínimas antes de dar un píxel por resuelto
VOTE_CONFIDENT = 0.8                # probabilidad media a partir de la cual deja de sumar
VOTE_STOP_SHARE = 0.995             # con esta fracción resuelta no se leen más escenas
_MAX_LOCAL_CLOUD = 80.0             # una escena casi cubierta no aporta al voto
TRAINING_EXTRA_DATES = 2            # fechas además de la escena con que se entrena (WorldCover)
_MOSAIC_MARGIN_PX = 5               # la imagen del año evita los bordes de nube que la SCL no marca
_RGB_GAMMA = 1.9                    # realce de tonos medios del color real

# Categorías del mapa de cambios (índice → color). Validada para daltonismo en
# todos los pares. Las etiquetas de pérdida/ganancia nombran la clase principal
# del esquema (vegetación o bosque); «Nueva zona urbana» solo existe con WorldCover.
CHANGE_COLORS = ["#d9ded3", "#b42318", "#0d9488", "#f59e0b", "#7c3aed", "#1b2430", "#475569"]
NO_DATA_CHANGE = 5


def change_labels(scheme_name: str | None = None) -> list[tuple[str, str]]:
    main = primary(scheme_name).label.lower()
    labels = ["Sin cambio", f"Pérdida de {main}", f"Ganancia de {main}",
              "Nuevo suelo expuesto / minería", "Otro cambio", "Sin datos / nube", "Nueva zona urbana"]
    return list(zip(CHANGE_COLORS, labels))


# Compatibilidad: etiquetas del esquema de reglas
CHANGE_LABELS = change_labels("rules")[:6]


class YearError(Exception):
    """Fallo controlado al procesar un año (sin escenas, red, etc.)."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ndjson(stage: str, progress: float, message: str, **extra) -> str:
    obj: dict = {"stage": stage, "progress": round(progress, 4), "message": message}
    obj.update(extra)
    return json.dumps(obj, ensure_ascii=False) + "\n"


def _replace_year(d: date, year: int) -> date:
    """Cambia el año de *d*; el 29 de febrero pasa a 28 en años no bisiestos."""
    try:
        return d.replace(year=year)
    except ValueError:
        return d.replace(year=year, day=28)


def seasonal_time_range(scene_dt: datetime, year: int, window_days: int = SEASON_WINDOW_DAYS) -> str:
    """Rango ``YYYY-MM-DD/YYYY-MM-DD`` de ±window_days alrededor de la misma fecha en *year*."""
    center = _replace_year(scene_dt.date(), year)
    start = center - timedelta(days=window_days)
    end = center + timedelta(days=window_days)
    return f"{start.isoformat()}/{end.isoformat()}"


def scene_year(session: SessionData) -> int:
    return datetime.fromisoformat(session.scene_datetime).year


def pixel_area_m2(session: SessionData) -> float:
    t = session.transform
    return abs(t.a * t.e) if t is not None else 100.0


def class_stats(class_map: np.ndarray, pixel_area: float, scheme_name: str | None = None) -> dict:
    """Píxeles, hectáreas, % del total y % del área despejada (sin nubes) por clase del esquema."""
    total = class_map.size
    n_valid = int(np.count_nonzero(class_map != -1))
    out = {}
    names = {c.code: c.key for c in scheme(scheme_name)} | {-1: "unclassified"}
    for label, name in names.items():
        n = int(np.count_nonzero(class_map == label))
        out[name] = {
            "pixels": n,
            "hectares": round(n * pixel_area / 10_000, 2),
            "percent": round(100.0 * n / total, 2) if total else 0.0,
            "percent_clear": (
                round(100.0 * n / n_valid, 2) if (n_valid and label != -1) else None
            ),
        }
    return out


def transition_matrix(past: np.ndarray, current: np.ndarray, scheme_name: str | None = None) -> list[list[int]]:
    """Matriz de transiciones (filas = pasado, columnas = actual).

    Orden: las clases del esquema por código y al final «sin datos» (-1).
    """
    order = [c.code for c in scheme(scheme_name)] + [-1]
    return [
        [int(np.count_nonzero((past == a) & (current == b))) for b in order]
        for a in order
    ]


def change_map(past: np.ndarray, current: np.ndarray) -> np.ndarray:
    """Codifica el cambio por píxel en índices de ``CHANGE_LABELS``."""
    out = np.zeros(past.shape, dtype=np.uint8)  # sin cambio
    changed = past != current
    out[changed] = 4  # otro cambio
    out[changed & (current == 3)] = 6  # nueva zona urbana (solo esquema WorldCover)
    out[changed & (current == 2)] = 3
    out[changed & (current == 0)] = 2
    out[changed & (past == 0)] = 1
    out[(past == -1) | (current == -1)] = NO_DATA_CHANGE
    return out


def _nanmean(arr: np.ndarray) -> float | None:
    finite = arr[np.isfinite(arr)]
    return round(float(finite.mean()), 4) if finite.size else None


# ---------------------------------------------------------------------------
# Procesamiento de un año
# ---------------------------------------------------------------------------

def _noop(_msg: str, **_extra) -> None:
    return None


def _scene_meta(scene: dict) -> dict:
    return {
        "id": scene["id"],
        "datetime": scene["datetime"],
        "cloud_cover": scene["cloud_cover"],
        "local_cloud": scene.get("local_cloud"),
    }


def _read_scene(session: SessionData, item, year: int) -> tuple[dict, np.ndarray]:
    """Bandas en reflectancia y máscara de nubes de *item* sobre la grilla de la sesión."""
    ref_shape = session.bands["B04"].shape
    assets = [*BAND_SET, SCL_ASSET]

    def _read(asset: str) -> np.ndarray:
        last: Exception | None = None
        for _ in range(3):
            try:
                return read_on_grid(
                    item.assets[asset].href, session.crs, session.transform, ref_shape,
                    Resampling.nearest if asset == SCL_ASSET else Resampling.bilinear,
                )
            except Exception as exc:  # noqa: BLE001
                last = exc
                time.sleep(1)
        raise YearError(f"{year}: fallo al descargar {asset} — {last}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=_BAND_WORKERS) as pool:
        raw = dict(zip(assets, pool.map(_read, assets)))
    offset = boa_offset(item)
    bands = {b: to_reflectance(raw[b], offset) for b in BAND_SET}
    return bands, cloud_mask_from_scl(raw[SCL_ASSET])


def _still_current(session: SessionData, model, current_map) -> None:
    if session.classifier is not model or session.class_map is not current_map:
        raise YearError("El modelo o el mapa cambió durante la comparación; vuelva a calcularla.")


def _primary_percent(class_map: np.ndarray) -> float | None:
    """% del área clasificada que ocupa la clase principal (código 0)."""
    n_valid = int(np.count_nonzero(class_map != -1))
    return round(100.0 * int(np.count_nonzero(class_map == 0)) / n_valid, 2) if n_valid else None


def process_year(
    session: SessionData,
    year: int,
    report: Callable[..., None] = _noop,
) -> dict:
    """Busca, descarga, enmascara y clasifica *year* (una escena o un compuesto).

    Guarda el resultado en ``session.comparisons[year]`` y lo devuelve.
    Lanza ``YearError`` si no hay escenas o falla la descarga.
    ``report(mensaje, **evento)`` recibe el progreso; el evento estructurado
    (año, escena i de n, año listo) alimenta la matriz de avance del frontend.
    """
    model, current_map = session.classifier, session.class_map
    if session.scenes_per_year > 1:
        entry = _composite_year(session, year, session.scenes_per_year, report)
    else:
        entry = _single_year(session, year, report)
    _still_current(session, model, current_map)
    session.comparisons[year] = entry
    report(f"{year}: ✓ clasificado.", year=year, year_done=True, n_scenes=entry["n_scenes"],
           primary_percent=_primary_percent(entry["class_map"]))
    return entry


def _single_year(session: SessionData, year: int, report: Callable[..., None]) -> dict:
    """Una escena: la más despejada de la misma temporada (o del año si no hay)."""
    scene_dt = datetime.fromisoformat(session.scene_datetime)
    model = session.classifier

    # 1. Búsqueda estacional (nubosidad local), fallback al año completo
    seasonal = seasonal_time_range(scene_dt, year)
    scene = None
    for time_range in (seasonal, f"{year}-01-01/{year}-12-31"):
        report(f"{year}: buscando escenas ({time_range})…", year=year)
        try:
            scene = best_scene(session.bbox, time_range, session.cloud_threshold)
            break
        except HTTPException as exc:
            if exc.status_code != 404:
                raise YearError(f"{year}: error del catálogo STAC — {exc.detail}") from exc
    if scene is None:
        raise YearError(
            f"{year}: sin escenas con nubosidad < {session.cloud_threshold:.0f} % "
            "(Sentinel-2 L2A tiene cobertura irregular antes de 2017)."
        )

    local = scene["local_cloud"]
    report(
        f"{year}: escena {scene['datetime'][:10]} "
        f"({scene['cloud_cover']:.1f} % nubes en el tile"
        + (f", {local:.1f} % en la zona)" if local is not None else ")"),
        year=year, scenes_total=1,
    )

    # 2. Bandas + SCL sobre la grilla actual, en paralelo
    bands, mask = _read_scene(session, scene["item"], year)
    report(f"{year}: {len(BAND_SET) + 1} capas descargadas, clasificando…", year=year)

    # 3. Índices y predicción
    indices = compute_all_indices(bands, mask)
    X_flat, valid = build_features(bands, indices)
    class_map = np.full(mask.shape, -1, dtype=np.int16)
    if X_flat.shape[0] > 0:
        class_map[valid] = model.predict(X_flat).astype(np.int16)
    report(f"{year}: escena clasificada.", year=year, scene_index=1, scenes_total=1,
           scene_date=scene["datetime"][:10])

    return {
        "classifier_id": session.classifier_id,
        "scenes_per_year": 1,
        "n_scenes": 1,
        "scene": _scene_meta(scene),
        "scenes": [_scene_meta(scene)],
        "rgb": {b: bands[b] for b in RGB_BANDS},
        "ndvi": indices["ndvi"],
        "class_map": class_map,
        "cloud_fraction": float(mask.mean()),
        "confidence": None,
    }


# ---------------------------------------------------------------------------
# Compuesto anual por voto de probabilidades
# ---------------------------------------------------------------------------

def composite_scenes(session: SessionData, year: int, n: int, exclude_date: str | None = None) -> list[dict]:
    """Las *n* escenas más despejadas de *year* dentro de la zona, una por fecha.

    Dos tiles que se solapan entregan la misma pasada dos veces: se conserva la
    de menor nubosidad local, porque repetirla no añade una observación independiente.
    """
    time_range = f"{year}-01-01/{year}-12-31"
    try:
        found = list_scenes(session.bbox, time_range, session.cloud_threshold, limit=max(2 * n, n + 4))
    except HTTPException as exc:
        if exc.status_code == 404:
            return []
        raise YearError(f"{year}: error del catálogo STAC — {exc.detail}") from exc
    by_date: dict[str, dict] = {}
    for scene in found:  # ya vienen ordenadas por nubosidad local
        day = scene["datetime"][:10]
        if day != exclude_date:
            by_date.setdefault(day, scene)
    scenes = list(by_date.values())
    usable = [s for s in scenes if s["local_cloud"] is None or s["local_cloud"] <= _MAX_LOCAL_CLOUD]
    return (usable or scenes)[:n]


def training_scenes(session: SessionData, n: int = TRAINING_EXTRA_DATES) -> list[tuple[int, dict]]:
    """Escenas de otras fechas para entrenar junto a la de la sesión: ``[(año, escena)]``.

    Una del mismo año (otra estación, otra turbidez del agua) y otra del año de
    WorldCover, cuando las etiquetas coinciden mejor con lo que se ve. Un modelo
    entrenado con una sola fecha confunde el agua de otras fechas con pastos.
    """
    year, day = scene_year(session), session.scene_datetime[:10]
    plan = [(year, 1), (WORLDCOVER_YEAR, n - 1)] if year != WORLDCOVER_YEAR else [(year, n)]
    picks: list[tuple[int, dict]] = []
    for y, k in plan:
        if k <= 0:
            continue
        try:
            picks += [(y, sc) for sc in composite_scenes(session, y, k, exclude_date=day)]
        except YearError:
            continue
    return picks[:n]


def read_training_scene(session: SessionData, year: int, scene: dict) -> tuple[dict, dict]:
    """Bandas e índices (nubes en NaN) de una escena de entrenamiento sobre la grilla de la sesión."""
    bands, mask = _read_scene(session, scene["item"], year)
    return bands, compute_all_indices(bands, mask)


class _Vote:
    """Acumula probabilidades por píxel y arma el compuesto del año."""

    def __init__(self, model, shape: tuple[int, int]):
        self.model = model
        self.shape = shape
        size = shape[0] * shape[1]
        self.proba = np.zeros((size, len(model.classes_)), dtype=np.float32)
        self.count = np.zeros(size, dtype=np.uint8)
        self.settled = np.zeros(size, dtype=bool)
        self.rgb = {b: np.full(shape, np.nan, dtype=np.float32) for b in RGB_BANDS}
        self.rgb_edge = {b: np.full(shape, np.nan, dtype=np.float32) for b in RGB_BANDS}
        self.first_rgb: dict | None = None
        self.ndvi_sum = np.zeros(shape, dtype=np.float32)
        self.ndvi_n = np.zeros(shape, dtype=np.uint8)
        self.scenes: list[dict] = []

    def add(self, meta: dict, bands: dict, mask: np.ndarray, indices: dict) -> None:
        X_flat, valid = build_features(bands, indices)
        rows = np.flatnonzero(valid.ravel())
        keep = ~self.settled[rows]
        if keep.any():
            self.proba[rows[keep]] += self.model.predict_proba(X_flat[keep]).astype(np.float32)
            self.count[rows[keep]] += 1
        if len(self.scenes) + 1 >= VOTE_MIN_OBS:
            self.settled = (self.count >= VOTE_MIN_OBS) & (self.proba.max(axis=1) >= VOTE_CONFIDENT * self.count)

        # Imagen: el primer píxel despejado gana (las escenas llegan de más a menos despejada).
        # Se prefieren píxeles lejos de una nube; los pegados a su borde solo rellenan huecos.
        if self.first_rgb is None:
            self.first_rgb = {b: bands[b] for b in RGB_BANDS}
        seen = np.isfinite(bands[RGB_BANDS[0]])
        near_cloud = ndimage.binary_dilation(mask, iterations=_MOSAIC_MARGIN_PX) if mask.any() else mask
        for target, clear in ((self.rgb, ~near_cloud & seen), (self.rgb_edge, ~mask & seen)):
            fill = clear & ~np.isfinite(target[RGB_BANDS[0]])
            for b in RGB_BANDS:
                target[b][fill] = bands[b][fill]
        ndvi = indices["ndvi"]
        ok = np.isfinite(ndvi)
        self.ndvi_sum[ok] += ndvi[ok]
        self.ndvi_n[ok] += 1
        self.scenes.append(meta)

    @property
    def done(self) -> bool:
        return len(self.scenes) >= VOTE_MIN_OBS and float(self.settled.mean()) >= VOTE_STOP_SHARE

    def entry(self, session: SessionData, requested: int) -> dict:
        observed = self.count > 0
        class_map = np.full(self.count.size, -1, dtype=np.int16)
        if observed.any():
            class_map[observed] = np.asarray(self.model.classes_)[self.proba[observed].argmax(axis=1)].astype(np.int16)
            confidence = float((self.proba[observed].max(axis=1) / self.count[observed]).mean())
        else:
            confidence = None
        # Huecos: primero píxeles despejados junto a una nube; si ninguna escena estuvo
        # despejada, la imagen de la más despejada (con su nube)
        for b in RGB_BANDS:
            for fallback in (self.rgb_edge[b], self.first_rgb[b]):
                hole = ~np.isfinite(self.rgb[b])
                self.rgb[b][hole] = fallback[hole]
        self.rgb_edge = {}
        with np.errstate(invalid="ignore", divide="ignore"):
            ndvi = np.where(self.ndvi_n > 0, self.ndvi_sum / self.ndvi_n, np.nan).astype(np.float32)
        return {
            "classifier_id": session.classifier_id,
            "scenes_per_year": requested,
            "n_scenes": len(self.scenes),
            "scene": self.scenes[0],
            "scenes": self.scenes,
            "rgb": self.rgb,
            "ndvi": ndvi,
            "class_map": class_map.reshape(self.shape),
            "cloud_fraction": float(1.0 - observed.mean()),
            "confidence": None if confidence is None else round(confidence, 4),
        }


def _vote_scenes(session: SessionData, year: int, vote: _Vote, scenes: list[dict],
                 report: Callable[..., None], total: int) -> None:
    for scene in scenes:
        if vote.done:
            report(f"{year}: el {100 * VOTE_STOP_SHARE:.1f} % de los píxeles ya está resuelto; "
                   "no hacen falta más escenas.", year=year, scenes_total=len(vote.scenes))
            break
        bands, mask = _read_scene(session, scene["item"], year)
        vote.add(_scene_meta(scene), bands, mask, compute_all_indices(bands, mask))
        report(f"{year}: escena {len(vote.scenes)} de {total} ({scene['datetime'][:10]}) clasificada.",
               year=year, scene_index=len(vote.scenes), scenes_total=total, scene_date=scene["datetime"][:10])


def _composite_year(session: SessionData, year: int, n: int, report: Callable[..., None]) -> dict:
    """Compuesto de *year*: hasta *n* escenas de todo el año, voto por píxel."""
    report(f"{year}: buscando las {n} escenas más despejadas del año…", year=year)
    scenes = composite_scenes(session, year, n)
    if not scenes:
        raise YearError(
            f"{year}: sin escenas con nubosidad < {session.cloud_threshold:.0f} % "
            "(Sentinel-2 L2A tiene cobertura irregular antes de 2017)."
        )
    report(f"{year}: {len(scenes)} escenas para el compuesto.", year=year, scenes_total=len(scenes))
    vote = _Vote(session.classifier, session.class_map.shape)
    _vote_scenes(session, year, vote, scenes, report, len(scenes))
    return vote.entry(session, n)


def ensure_current(session: SessionData, report: Callable[..., None] = _noop) -> None:
    """Con compuestos anuales, compone también el año actual (si aún no existe).

    La escena de la sesión ya está en memoria y es la primera observación; se
    suman las otras más despejadas de su mismo año calendario.
    """
    n = session.scenes_per_year
    if n <= 1:
        return
    with session.lock:
        if session.active_map() is not session.class_map:
            return
        model, current_map = session.classifier, session.class_map
        year = scene_year(session)
        if not session.indices:
            compute_indices(session)
        report(f"{year}: componiendo el año actual con hasta {n} escenas…", year=year)
        others = composite_scenes(session, year, n - 1, exclude_date=session.scene_datetime[:10])
        total = 1 + len(others)
        report(f"{year}: {total} escenas para el compuesto.", year=year, scenes_total=total)
        vote = _Vote(model, current_map.shape)
        mask = session.cloud_mask if session.cloud_mask is not None else np.zeros(current_map.shape, dtype=bool)
        vote.add({"id": session.scene_id, "datetime": session.scene_datetime, "cloud_cover": session.cloud_cover,
                  "local_cloud": round(session.cloud_fraction * 100, 2)},
                 session.bands, mask, session.indices)
        report(f"{year}: escena 1 de {total} ({session.scene_datetime[:10]}) clasificada.",
               year=year, scene_index=1, scenes_total=total, scene_date=session.scene_datetime[:10])
        _vote_scenes(session, year, vote, others, report, total)
        entry = vote.entry(session, n)
        _still_current(session, model, current_map)
        session.current_composite = entry
        report(f"{year}: ✓ compuesto del año actual listo.", year=year, year_done=True,
               n_scenes=entry["n_scenes"], primary_percent=_primary_percent(entry["class_map"]))


def current_entry(session: SessionData) -> dict:
    """El año actual con la forma de una entrada de ``session.comparisons``."""
    comp = session.current_composite
    if comp is not None and session.active_map() is comp["class_map"]:
        return comp
    if not session.indices:
        compute_indices(session)
    scene = {
        "id": session.scene_id,
        "datetime": session.scene_datetime,
        "cloud_cover": session.cloud_cover,
        "local_cloud": round(session.cloud_fraction * 100, 2),
    }
    return {
        "classifier_id": session.classifier_id,
        "scenes_per_year": 1,
        "n_scenes": 1,
        "scene": scene,
        "scenes": [scene],
        "rgb": session.bands,
        "ndvi": session.indices["ndvi"],
        "class_map": session.class_map,
        "cloud_fraction": session.cloud_fraction,
        "confidence": None,
    }


def year_entry(session: SessionData, year: int | None) -> dict:
    """Entrada de *year*; ``None`` o el año de la escena devuelven el año actual."""
    if year is None or year == scene_year(session):
        return current_entry(session)
    return session.comparisons[year]


def set_scenes_per_year(session: SessionData, n: int | None) -> None:
    """Cambia el método de la sesión; años medidos con otro método no se mezclan."""
    if n is None or n == session.scenes_per_year:
        return
    if n not in COMPOSITE_CHOICES:
        raise ValueError(f"scenes_per_year debe ser uno de {COMPOSITE_CHOICES}.")
    session.scenes_per_year = n
    session.comparisons.clear()
    session.current_composite = None


def _check_session(session_id: str) -> tuple[SessionData | None, str | None]:
    session = get_session(session_id)
    if session is None:
        return None, _ndjson("error", 0.0, "Sesión no encontrada o expirada.", error="session_not_found")
    if session.classifier is None or session.class_map is None:
        return None, _ndjson("error", 0.0, "Primero entrene el clasificador y genere el mapa actual.",
                             error="missing_class_map")
    return session, None


def reporter(q: "queue.Queue", on_message: Callable[[], None] | None = None) -> Callable[..., None]:
    """``report(mensaje, **evento)`` que encola el progreso para :func:`_drain`."""
    def report(msg: str, **event) -> None:
        if on_message is not None:
            on_message()
        q.put((msg, event) if event else msg)
    return report


def _drain(q: "queue.Queue", done: threading.Event | Callable[[], bool], progress: Callable[[], float],
           stage: str) -> Generator[str, None, None]:
    """Emite los mensajes del worker y un latido periódico hasta que termine.

    Un mensaje puede ser un texto o ``(texto, evento)``; el evento viaja en la
    línea NDJSON como ``event``.
    """
    is_done = done.is_set if isinstance(done, threading.Event) else done
    last = time.monotonic()
    while not is_done() or not q.empty():
        try:
            msg = q.get(timeout=0.5)
            if isinstance(msg, tuple):
                yield _ndjson(stage, progress(), msg[0], event=msg[1])
            else:
                yield _ndjson(stage, progress(), msg)
            last = time.monotonic()
        except queue.Empty:
            if time.monotonic() - last > _HEARTBEAT_S:
                yield _ndjson(stage, progress(), "Procesando…")
                last = time.monotonic()


# ---------------------------------------------------------------------------
# Comparativa de un año
# ---------------------------------------------------------------------------

def compare_stream(session_id: str, year: int) -> Generator[str, None, None]:
    """Procesa *year* y emite NDJSON; la línea ``done`` lleva el resumen."""
    session, err = _check_session(session_id)
    if err:
        yield err
        return

    start = time.monotonic()
    q: "queue.Queue[str]" = queue.Queue()
    done = threading.Event()
    result: dict = {}
    steps = [0]

    per_year = 3 + 2 * session.scenes_per_year      # mensajes esperados por año
    todo = 1 + (1 if session.scenes_per_year > 1 and session.active_map() is session.class_map else 0)

    def _count():
        steps[0] += 1

    def _worker():
        try:
            report = reporter(q, _count)
            ensure_current(session, report)
            process_year(session, year, report)
        except YearError as exc:
            result["error"] = str(exc)
        except Exception as exc:  # noqa: BLE001
            result["error"] = f"{year}: error inesperado — {exc}"
        finally:
            done.set()

    threading.Thread(target=_worker, daemon=True).start()
    yield _ndjson("searching", 0.02, f"Procesando {year}…")
    yield from _drain(q, done, lambda: min(0.95, 0.05 + 0.9 * steps[0] / (per_year * todo)), "processing")

    if "error" in result:
        yield _ndjson("error", 0.5, result["error"], error=result["error"])
        return

    elapsed = time.monotonic() - start
    yield _ndjson("done", 1.0, f"Comparativa {year} vs {scene_year(session)} lista en {elapsed:.1f} s.",
                  comparison=build_summary(session, year))


def build_summary(session: SessionData, year: int) -> dict:
    comp = session.comparisons[year]
    cur = current_entry(session)
    area = pixel_area_m2(session)
    past_map, current_map = comp["class_map"], cur["class_map"]
    both_valid = (past_map != -1) & (current_map != -1)
    changed = both_valid & (past_map != current_map)
    n_both = int(np.count_nonzero(both_valid))
    return {
        "year": year,
        "past_scene": comp["scene"],
        "current_scene": cur["scene"],
        "past_n_scenes": comp.get("n_scenes", 1),
        "current_n_scenes": cur["n_scenes"],
        "scenes_per_year": session.scenes_per_year,
        "pixel_area_m2": area,
        "past": class_stats(past_map, area, session.class_scheme),
        "current": class_stats(current_map, area, session.class_scheme),
        "transitions": transition_matrix(past_map, current_map, session.class_scheme),
        "classes": scheme_json(session.class_scheme),
        "changed_percent": round(100.0 * np.count_nonzero(changed) / n_both, 2) if n_both else 0.0,
        "comparable_percent": round(100.0 * n_both / past_map.size, 2),
    }


# ---------------------------------------------------------------------------
# Serie temporal
# ---------------------------------------------------------------------------

def _series_point(session: SessionData, year: int, entry: dict) -> dict:
    stats = class_stats(entry["class_map"], pixel_area_m2(session), session.class_scheme)
    scenes = entry.get("scenes") or [entry["scene"]]
    return {
        "year": year,
        "scene": entry["scene"],
        # Escenas que votaron el año (una sola con el método de escena única)
        "n_scenes": entry.get("n_scenes", 1),
        "scene_dates": sorted(s["datetime"][:10] for s in scenes),
        "confidence": entry.get("confidence"),
        "stats": stats,
        "ndvi_mean": _nanmean(entry["ndvi"]),
        "clear_percent": round(100.0 * (1.0 - entry["cloud_fraction"]), 2),
        # Píxeles realmente clasificados: excluye nubes y también huecos sin datos
        # de la escena (bordes de órbita, bandas vacías) que la SCL no siempre marca.
        "valid_percent": round(100.0 - stats["unclassified"]["percent"], 2),
    }


TREND_ALPHA = 0.05
MIN_VALID_PERCENT = 50.0


def trend_test(xs: list[float], ys: list[float]) -> dict | None:
    """Tendencia no paramétrica: pendiente de Theil-Sen + prueba de Mann-Kendall.

    - Theil-Sen: mediana de las pendientes entre todos los pares de años; robusta
      frente a años atípicos (p. ej. una escena con nubes residuales).
    - Mann-Kendall: equivale a la tau de Kendall entre año y valor; el p-valor
      (bilateral, exacto para series cortas) indica si hay tendencia monótona.
    - IC 95 % de la pendiente según Sen.

    Devuelve None con menos de 4 años (no hay potencia estadística).
    """
    if len(xs) < 4:
        return None
    x = np.asarray(xs, dtype=float)
    y = np.asarray(ys, dtype=float)
    slope, _intercept, low, high = stats.theilslopes(y, x, alpha=1 - TREND_ALPHA)[:4]
    tau, p_value = stats.kendalltau(x, y)
    if not np.isfinite(p_value):  # serie constante
        tau, p_value = 0.0, 1.0
    return {
        "slope": round(float(slope), 4),
        "slope_low": round(float(low), 4),
        "slope_high": round(float(high), 4),
        "tau": round(float(tau), 3),
        "p_value": round(float(p_value), 4),
        "significant": bool(p_value < TREND_ALPHA),
        "n": int(len(x)),
    }


def build_series(session: SessionData) -> dict:
    """Serie temporal con todos los años procesados + el actual, y tendencias."""
    points = [_series_point(session, y, c) for y, c in session.comparisons.items()]
    points.append(_series_point(session, scene_year(session), current_entry(session)))
    points.sort(key=lambda p: p["year"])

    total_ha = session.class_map.size * pixel_area_m2(session) / 10_000
    # Tendencias sobre el % del área clasificada (robusto frente a nubes); solo años
    # con al menos 50 % de la zona clasificada. Un año sin datos nunca entra como 0.
    usable = [p for p in points if p["valid_percent"] >= MIN_VALID_PERCENT]
    trends = {}
    for name in [c.key for c in scheme(session.class_scheme)]:
        t = trend_test([p["year"] for p in usable],
                       [p["stats"][name]["percent_clear"] or 0.0 for p in usable])
        if t:
            to_ha = total_ha / 100
            t["ha_per_year"] = round(t["slope"] * to_ha, 2)
            t["ha_per_year_low"] = round(t["slope_low"] * to_ha, 2)
            t["ha_per_year_high"] = round(t["slope_high"] * to_ha, 2)
        trends[name] = t
    ndvi_trend = trend_test([p["year"] for p in usable if p["ndvi_mean"] is not None],
                            [p["ndvi_mean"] for p in usable if p["ndvi_mean"] is not None])
    return {
        "points": points,
        "trends": trends,
        "ndvi_trend": ndvi_trend,
        "total_hectares": round(total_ha, 2),
        "years_used_for_trend": [p["year"] for p in usable],
        "min_valid_percent": MIN_VALID_PERCENT,
        "classes": scheme_json(session.class_scheme),
        "scenes_per_year": session.scenes_per_year,
    }


def timeseries_stream(session_id: str, years_back: int) -> Generator[str, None, None]:
    """Procesa hasta *years_back* años anteriores en paralelo y emite NDJSON."""
    session, err = _check_session(session_id)
    if err:
        yield err
        return

    start = time.monotonic()
    current = scene_year(session)
    years = [current - k for k in range(1, years_back + 1)]
    todo = [y for y in years if y not in session.comparisons]
    cached = len(years) - len(todo)
    n = session.scenes_per_year
    # Con compuestos, el año actual se mide igual que los demás
    if n > 1 and session.active_map() is session.class_map:
        todo.insert(0, current)
    yield _ndjson("searching", 0.01,
                  f"Serie {years[-1]}–{current}: {len(todo)} años por procesar"
                  + (f", {cached} ya calculados." if cached else ".")
                  + (f" Compuesto de hasta {n} escenas por año." if n > 1 else ""),
                  event={"plan": {"years": sorted(todo), "cached": sorted(set(years) - set(todo)),
                                  "scenes_per_year": n, "current_year": current}})

    q: "queue.Queue" = queue.Queue()
    finished: list[int] = []
    failures: dict[int, str] = {}
    partial: dict[int, float] = {}      # fracción de escenas ya clasificadas de cada año en curso
    push = reporter(q)

    def report(msg: str, **event) -> None:
        if event.get("scene_index") and event.get("scenes_total"):
            partial[event["year"]] = event["scene_index"] / event["scenes_total"]
        push(msg, **event)

    def _run(year: int):
        try:
            if year == current:
                ensure_current(session, report)
            else:
                process_year(session, year, report)
        except YearError as exc:
            failures[year] = str(exc)
            report(f"⚠ {exc}", year=year, year_failed=True)
        except Exception as exc:  # noqa: BLE001
            failures[year] = f"{year}: error inesperado — {exc}"
            report(f"⚠ {failures[year]}", year=year, year_failed=True)
        finally:
            finished.append(year)

    pool = concurrent.futures.ThreadPoolExecutor(max_workers=_YEAR_WORKERS)
    for y in todo:
        pool.submit(_run, y)
    pool.shutdown(wait=False)

    total = max(1, len(todo))

    def _progress() -> float:
        done_years = set(finished)
        running = sum(f for y, f in list(partial.items()) if y not in done_years)
        return 0.02 + 0.95 * min(1.0, (len(done_years) + 0.95 * running) / total)

    yield from _drain(q, lambda: len(finished) == len(todo), _progress, "processing")

    if current in failures:
        # Sin el compuesto del año actual no hay con qué comparar los demás años
        yield _ndjson("error", 1.0, failures[current], error=failures[current])
        return
    series = build_series(session)
    series["failed"] = [{"year": y, "error": failures[y]} for y in sorted(failures)]
    ok = len(series["points"]) - 1
    if ok == 0:
        msg = "Ningún año pudo procesarse."
        yield _ndjson("error", 1.0, msg, error="; ".join(failures.values()) or msg)
        return
    elapsed = time.monotonic() - start
    yield _ndjson("done", 1.0, f"Serie temporal lista: {ok} años + actual en {elapsed:.0f} s.",
                  series=series)


# ---------------------------------------------------------------------------
# Figuras y capas
# ---------------------------------------------------------------------------

def _rgb_stretch(session: SessionData) -> tuple[np.ndarray, np.ndarray]:
    """Rango de reflectancia del color real, común a los tres canales y a todos los años.

    Percentiles 0,5–99,5 de los píxeles despejados de la escena actual, tomando rojo,
    verde y azul juntos: estirar cada canal por separado altera el color (el bosque
    sale cian y los potreros blancos), y un rango por año impediría comparar.
    """
    stack = np.stack([session.bands[b] for b in RGB_BANDS], axis=-1)
    clear = np.isfinite(stack).all(axis=-1)
    if session.cloud_mask is not None and session.cloud_mask.shape == clear.shape and (clear & ~session.cloud_mask).any():
        clear &= ~session.cloud_mask
    values = stack[clear] if clear.any() else np.array([0.0, 0.3], dtype=np.float32)
    lo, hi = np.percentile(values, [0.5, 99.5])
    return np.full(3, lo, dtype=np.float32), np.full(3, max(hi, lo + 1e-3), dtype=np.float32)


def _rgb(bands: dict, p_lo: np.ndarray, p_hi: np.ndarray) -> np.ndarray:
    rgb = np.stack([bands[b] for b in RGB_BANDS], axis=-1)
    rgb = (rgb - p_lo) / np.maximum(p_hi - p_lo, 1e-6)
    return np.nan_to_num(np.clip(rgb, 0, 1), nan=0.0) ** (1.0 / _RGB_GAMMA)


def render_comparison(session: SessionData, year: int, fmt: str = "png", dpi: int = 100) -> bytes:
    """Figura 2×3: color real, ΔNDVI, clasificaciones de ambos años y mapa de cambios.

    ``fmt="jpeg"`` produce una versión liviana para incrustar en el reporte.
    """
    comp = session.comparisons[year]
    cur = current_entry(session)
    cur_year = scene_year(session)
    p_lo, p_hi = _rgb_stretch(session)

    d_ndvi = cur["ndvi"] - comp["ndvi"]

    n = len(scheme(session.class_scheme))
    class_cmap = ListedColormap(class_palette(session.class_scheme))
    labels = change_labels(session.class_scheme)
    fig, axes = plt.subplots(2, 3, figsize=(15, 9.5), dpi=100)

    axes[0, 0].imshow(_rgb(comp["rgb"], p_lo, p_hi))
    axes[0, 0].set_title(f"Color real {year}")
    axes[0, 1].imshow(_rgb(cur["rgb"], p_lo, p_hi))
    axes[0, 1].set_title(f"Color real {cur_year}")
    im = axes[0, 2].imshow(np.ma.masked_invalid(d_ndvi), cmap="RdYlGn", vmin=-0.6, vmax=0.6)
    axes[0, 2].set_title(f"ΔNDVI ({cur_year} − {year})")
    fig.colorbar(im, ax=axes[0, 2], fraction=0.046, pad=0.04)

    axes[1, 0].imshow(_class_map_to_index(comp["class_map"], n), cmap=class_cmap, vmin=0, vmax=n,
                      interpolation="nearest")
    axes[1, 0].set_title(f"Clasificación {year}")
    axes[1, 1].imshow(_class_map_to_index(cur["class_map"], n), cmap=class_cmap, vmin=0, vmax=n,
                      interpolation="nearest")
    axes[1, 1].set_title(f"Clasificación {cur_year}")
    axes[1, 2].imshow(change_map(comp["class_map"], cur["class_map"]), cmap=ListedColormap(CHANGE_COLORS),
                      vmin=0, vmax=len(CHANGE_COLORS) - 1, interpolation="nearest")
    axes[1, 2].set_title("Mapa de cambios")
    axes[1, 2].legend(
        handles=[mpatches.Patch(color=c, label=l) for c, l in labels
                 if session.class_scheme == "worldcover" or l != "Nueva zona urbana"],
        loc="lower right", fontsize=7, framealpha=0.85,
    )

    for ax in axes.flat:
        ax.axis("off")
    fig.suptitle(f"Comparativa temporal {year} → {cur_year}", fontsize=14, fontweight="bold")
    fig.tight_layout()

    buf = io.BytesIO()
    kwargs = {"pil_kwargs": {"quality": 80}} if fmt == "jpeg" else {}
    fig.savefig(buf, format=fmt, bbox_inches="tight", dpi=dpi, **kwargs)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


LAYER_KINDS = ("rgb", "class", "ndvi", "change")


def _palette_rgba(colors: list[str]) -> np.ndarray:
    return (np.array([to_rgba(c) for c in colors]) * 255).astype(np.uint8)


def render_layer(session: SessionData, kind: str, year: int | None = None) -> bytes:
    """PNG RGBA sin ejes, alineado a la grilla de la sesión (para superponer en el mapa).

    *year* = None → la escena elegida (su imagen y su NDVI) con el mapa vigente;
    el año de la escena → el año actual tal como entra en la serie (el compuesto,
    si lo hay); otro año → su comparativa.  ``change`` requiere un año anterior y
    solo pinta los píxeles con cambio.
    """
    is_current = year is None or year == scene_year(session)
    src = None if year is None else year_entry(session, year)
    h, w = session.class_map.shape if session.class_map is not None else session.bands["B04"].shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    if kind == "rgb":
        p_lo, p_hi = _rgb_stretch(session)
        bands = src["rgb"] if src else session.bands
        rgb = _rgb(bands, p_lo, p_hi)
        rgba[..., :3] = (rgb * 255).astype(np.uint8)
        rgba[..., 3] = np.where(np.isfinite(bands["B04"]), 255, 0)
    elif kind == "class":
        cmap = src["class_map"] if src else session.active_map()
        rgba[:] = _palette_rgba(class_palette(session.class_scheme))[
            _class_map_to_index(cmap, len(scheme(session.class_scheme)))
        ]
        rgba[cmap == -1, 3] = 0
    elif kind == "ndvi":
        if src is None and not session.indices:
            compute_indices(session)
        ndvi = src["ndvi"] if src else session.indices["ndvi"]
        norm = np.clip((np.nan_to_num(ndvi, nan=0.0) + 0.2) / 1.1, 0, 1)
        rgba[:] = (plt.get_cmap("RdYlGn")(norm) * 255).astype(np.uint8)
        rgba[~np.isfinite(ndvi), 3] = 0
    elif kind == "change":
        if is_current:
            raise ValueError("La capa de cambios requiere un año comparado.")
        codes = change_map(src["class_map"], session.active_map())
        rgba[:] = _palette_rgba(CHANGE_COLORS)[codes]
        rgba[(codes == 0) | (codes == 5), 3] = 0
    else:
        raise ValueError(f"Capa '{kind}' no válida. Opciones: {LAYER_KINDS}.")

    buf = io.BytesIO()
    plt.imsave(buf, rgba, format="png")
    return buf.getvalue()
