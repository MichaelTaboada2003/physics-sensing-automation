"""
core/compare.py
---------------
Análisis temporal: comparativa de un año y serie de hasta 10 años.

Para cada año:
- Búsqueda estacional: ±60 días alrededor de la misma fecha del año objetivo
  (misma época fenológica), eligiendo la escena con menos nubes *dentro del
  bbox* (SCL).  Si no hay escenas, se amplía al año completo.
- Alineación: cada banda se reproyecta (WarpedVRT) directamente sobre la grilla
  de la escena actual, de modo que los mapas son comparables píxel a píxel.
- Radiometría: los DN se convierten a reflectancia con el offset propio de cada
  escena (baseline 04.00 → +1000), así ambos años están en la misma escala.
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
from scipy import stats

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.colors import ListedColormap, to_rgba

from core.classifier import build_features
from core.export import CLASS_COLORS, _class_map_to_index
from core.indices import compute_all_indices, compute_indices
from core.search import best_scene
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
_YEAR_WORKERS = 3        # años procesados en paralelo en la serie temporal
_BAND_WORKERS = 6

CLASS_NAMES = {0: "vegetation", 1: "water", 2: "mining", -1: "unclassified"}

# Categorías del mapa de cambios (índice → color, etiqueta)
# Validada para daltonismo en todos los pares (rojo/teal/violeta/ámbar)
CHANGE_LABELS = [
    ("#d9ded3", "Sin cambio"),
    ("#b42318", "Pérdida de vegetación"),
    ("#0d9488", "Ganancia de vegetación"),
    ("#f59e0b", "Nuevo suelo expuesto / minería"),
    ("#7c3aed", "Otro cambio"),
    ("#1b2430", "Sin datos / nube"),
]
_CHANGE_CMAP = ListedColormap([c for c, _ in CHANGE_LABELS])


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


def class_stats(class_map: np.ndarray, pixel_area: float) -> dict:
    """Píxeles, hectáreas, % del total y % del área despejada (sin nubes) por clase."""
    total = class_map.size
    n_valid = int(np.count_nonzero(class_map != -1))
    out = {}
    for label, name in CLASS_NAMES.items():
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


def transition_matrix(past: np.ndarray, current: np.ndarray) -> list[list[int]]:
    """Matriz 4×4 de transiciones (filas = pasado, columnas = actual).

    Orden de clases: vegetación, agua, minería, no clasificado.
    """
    order = [0, 1, 2, -1]
    return [
        [int(np.count_nonzero((past == a) & (current == b))) for b in order]
        for a in order
    ]


def change_map(past: np.ndarray, current: np.ndarray) -> np.ndarray:
    """Codifica el cambio por píxel en índices de ``CHANGE_LABELS``."""
    out = np.zeros(past.shape, dtype=np.uint8)  # sin cambio
    changed = past != current
    out[changed] = 4  # otro cambio
    out[changed & (current == 2)] = 3
    out[changed & (current == 0)] = 2
    out[changed & (past == 0)] = 1
    out[(past == -1) | (current == -1)] = 5
    return out


def _nanmean(arr: np.ndarray) -> float | None:
    finite = arr[np.isfinite(arr)]
    return round(float(finite.mean()), 4) if finite.size else None


# ---------------------------------------------------------------------------
# Procesamiento de un año
# ---------------------------------------------------------------------------

def process_year(
    session: SessionData,
    year: int,
    report: Callable[[str], None] = lambda _msg: None,
) -> dict:
    """Busca, descarga, enmascara y clasifica la escena de *year*.

    Guarda el resultado en ``session.comparisons[year]`` y lo devuelve.
    Lanza ``YearError`` si no hay escenas o falla la descarga.
    """
    scene_dt = datetime.fromisoformat(session.scene_datetime)

    # 1. Búsqueda estacional (nubosidad local), fallback al año completo
    seasonal = seasonal_time_range(scene_dt, year)
    scene = None
    for time_range in (seasonal, f"{year}-01-01/{year}-12-31"):
        report(f"{year}: buscando escenas ({time_range})…")
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

    item = scene["item"]
    local = scene["local_cloud"]
    report(
        f"{year}: escena {scene['datetime'][:10]} "
        f"({scene['cloud_cover']:.1f} % nubes en el tile"
        + (f", {local:.1f} % en la zona)" if local is not None else ")")
    )

    # 2. Bandas + SCL sobre la grilla actual, en paralelo
    ref_shape = session.class_map.shape
    assets = [*BAND_SET, SCL_ASSET]
    raw: dict[str, np.ndarray] = {}

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
        for asset, data in zip(assets, pool.map(_read, assets)):
            raw[asset] = data
    report(f"{year}: {len(assets)} capas descargadas, clasificando…")

    # 3. Reflectancia, máscara de nubes, índices y predicción
    offset = boa_offset(item)
    bands = {b: to_reflectance(raw[b], offset) for b in BAND_SET}
    mask = cloud_mask_from_scl(raw[SCL_ASSET])
    indices = compute_all_indices(bands, mask)
    X_flat, valid = build_features(bands, indices)
    class_map = np.full(ref_shape, -1, dtype=np.int16)
    if X_flat.shape[0] > 0:
        class_map[valid] = session.classifier.predict(X_flat).astype(np.int16)

    entry = {
        "scene": {
            "id": scene["id"],
            "datetime": scene["datetime"],
            "cloud_cover": scene["cloud_cover"],
            "local_cloud": local,
        },
        "rgb": {b: bands[b] for b in RGB_BANDS},
        "ndvi": indices["ndvi"],
        "class_map": class_map,
        "cloud_fraction": float(mask.mean()),
    }
    session.comparisons[year] = entry
    return entry


def _check_session(session_id: str) -> tuple[SessionData | None, str | None]:
    session = get_session(session_id)
    if session is None:
        return None, _ndjson("error", 0.0, "Sesión no encontrada o expirada.", error="session_not_found")
    if session.classifier is None or session.class_map is None:
        return None, _ndjson("error", 0.0, "Primero entrene el clasificador y genere el mapa actual.",
                             error="missing_class_map")
    return session, None


def _drain(q: "queue.Queue[str]", done: threading.Event | Callable[[], bool], progress: Callable[[], float],
           stage: str) -> Generator[str, None, None]:
    """Emite los mensajes del worker y un latido periódico hasta que termine."""
    is_done = done.is_set if isinstance(done, threading.Event) else done
    last = time.monotonic()
    while not is_done() or not q.empty():
        try:
            msg = q.get(timeout=0.5)
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

    def _worker():
        try:
            def report(msg: str):
                steps[0] += 1
                q.put(msg)
            process_year(session, year, report)
        except YearError as exc:
            result["error"] = str(exc)
        except Exception as exc:  # noqa: BLE001
            result["error"] = f"{year}: error inesperado — {exc}"
        finally:
            done.set()

    threading.Thread(target=_worker, daemon=True).start()
    yield _ndjson("searching", 0.02, f"Procesando {year}…")
    yield from _drain(q, done, lambda: min(0.95, 0.05 + 0.2 * steps[0]), "processing")

    if "error" in result:
        yield _ndjson("error", 0.5, result["error"], error=result["error"])
        return

    elapsed = time.monotonic() - start
    yield _ndjson("done", 1.0, f"Comparativa {year} vs {scene_year(session)} lista en {elapsed:.1f} s.",
                  comparison=build_summary(session, year))


def build_summary(session: SessionData, year: int) -> dict:
    comp = session.comparisons[year]
    area = pixel_area_m2(session)
    past_map, current_map = comp["class_map"], session.class_map
    both_valid = (past_map != -1) & (current_map != -1)
    changed = both_valid & (past_map != current_map)
    n_both = int(np.count_nonzero(both_valid))
    return {
        "year": year,
        "past_scene": comp["scene"],
        "current_scene": {
            "id": session.scene_id,
            "datetime": session.scene_datetime,
            "cloud_cover": session.cloud_cover,
            "local_cloud": round(session.cloud_fraction * 100, 2),
        },
        "pixel_area_m2": area,
        "past": class_stats(past_map, area),
        "current": class_stats(current_map, area),
        "transitions": transition_matrix(past_map, current_map),
        "changed_percent": round(100.0 * np.count_nonzero(changed) / n_both, 2) if n_both else 0.0,
        "comparable_percent": round(100.0 * n_both / past_map.size, 2),
    }


# ---------------------------------------------------------------------------
# Serie temporal
# ---------------------------------------------------------------------------

def _series_point(session: SessionData, year: int, class_map: np.ndarray, ndvi: np.ndarray,
                  scene: dict, cloud_fraction: float) -> dict:
    stats = class_stats(class_map, pixel_area_m2(session))
    return {
        "year": year,
        "scene": scene,
        "stats": stats,
        "ndvi_mean": _nanmean(ndvi),
        "clear_percent": round(100.0 * (1.0 - cloud_fraction), 2),
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
    if not session.indices:
        compute_indices(session)
    current = {
        "id": session.scene_id,
        "datetime": session.scene_datetime,
        "cloud_cover": session.cloud_cover,
        "local_cloud": round(session.cloud_fraction * 100, 2),
    }
    points = [
        _series_point(session, y, c["class_map"], c["ndvi"], c["scene"], c["cloud_fraction"])
        for y, c in session.comparisons.items()
    ]
    points.append(_series_point(session, scene_year(session), session.class_map,
                                session.indices["ndvi"], current, session.cloud_fraction))
    points.sort(key=lambda p: p["year"])

    total_ha = session.class_map.size * pixel_area_m2(session) / 10_000
    # Tendencias sobre el % del área clasificada (robusto frente a nubes); solo años
    # con al menos 50 % de la zona clasificada. Un año sin datos nunca entra como 0.
    usable = [p for p in points if p["valid_percent"] >= MIN_VALID_PERCENT]
    trends = {}
    for name in ("vegetation", "water", "mining"):
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
    yield _ndjson("searching", 0.01,
                  f"Serie {years[-1]}–{current}: {len(todo)} años por procesar"
                  + (f", {cached} ya calculados." if cached else "."))

    q: "queue.Queue[str]" = queue.Queue()
    finished: list[int] = []
    failures: dict[int, str] = {}

    def _run(year: int):
        try:
            process_year(session, year, q.put)
            q.put(f"{year}: ✓ clasificado.")
        except YearError as exc:
            failures[year] = str(exc)
            q.put(f"⚠ {exc}")
        except Exception as exc:  # noqa: BLE001
            failures[year] = f"{year}: error inesperado — {exc}"
            q.put(f"⚠ {failures[year]}")
        finally:
            finished.append(year)

    pool = concurrent.futures.ThreadPoolExecutor(max_workers=_YEAR_WORKERS)
    for y in todo:
        pool.submit(_run, y)
    pool.shutdown(wait=False)

    total = max(1, len(todo))
    yield from _drain(q, lambda: len(finished) == len(todo),
                      lambda: 0.02 + 0.95 * len(finished) / total, "processing")

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
    """Percentiles 2–98 de la escena actual, aplicados a todos los años (reflectancia común)."""
    stack = np.stack([session.bands[b] for b in RGB_BANDS], axis=-1)
    return np.nanpercentile(stack, 2, axis=(0, 1)), np.nanpercentile(stack, 98, axis=(0, 1))


def _rgb(bands: dict, p_lo: np.ndarray, p_hi: np.ndarray) -> np.ndarray:
    rgb = np.stack([bands[b] for b in RGB_BANDS], axis=-1)
    rgb = (rgb - p_lo) / np.maximum(p_hi - p_lo, 1e-6)
    return np.nan_to_num(np.clip(rgb, 0, 1), nan=0.0)


def render_comparison(session: SessionData, year: int, fmt: str = "png", dpi: int = 100) -> bytes:
    """Figura 2×3: color real, ΔNDVI, clasificaciones de ambos años y mapa de cambios.

    ``fmt="jpeg"`` produce una versión liviana para incrustar en el reporte.
    """
    comp = session.comparisons[year]
    cur_year = scene_year(session)
    p_lo, p_hi = _rgb_stretch(session)

    if not session.indices:
        compute_indices(session)
    d_ndvi = session.indices["ndvi"] - comp["ndvi"]

    class_cmap = ListedColormap(CLASS_COLORS)
    fig, axes = plt.subplots(2, 3, figsize=(15, 9.5), dpi=100)

    axes[0, 0].imshow(_rgb(comp["rgb"], p_lo, p_hi))
    axes[0, 0].set_title(f"Color real {year}")
    axes[0, 1].imshow(_rgb(session.bands, p_lo, p_hi))
    axes[0, 1].set_title(f"Color real {cur_year}")
    im = axes[0, 2].imshow(np.ma.masked_invalid(d_ndvi), cmap="RdYlGn", vmin=-0.6, vmax=0.6)
    axes[0, 2].set_title(f"ΔNDVI ({cur_year} − {year})")
    fig.colorbar(im, ax=axes[0, 2], fraction=0.046, pad=0.04)

    axes[1, 0].imshow(_class_map_to_index(comp["class_map"]), cmap=class_cmap, vmin=0, vmax=3,
                      interpolation="nearest")
    axes[1, 0].set_title(f"Clasificación {year}")
    axes[1, 1].imshow(_class_map_to_index(session.class_map), cmap=class_cmap, vmin=0, vmax=3,
                      interpolation="nearest")
    axes[1, 1].set_title(f"Clasificación {cur_year}")
    axes[1, 2].imshow(change_map(comp["class_map"], session.class_map), cmap=_CHANGE_CMAP,
                      vmin=0, vmax=len(CHANGE_LABELS) - 1, interpolation="nearest")
    axes[1, 2].set_title("Mapa de cambios")
    axes[1, 2].legend(
        handles=[mpatches.Patch(color=c, label=l) for c, l in CHANGE_LABELS],
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

    *year* = None → escena actual; si no, la comparativa de ese año.
    ``change`` requiere *year* y solo pinta los píxeles con cambio.
    """
    src = session.comparisons[year] if year is not None else None
    h, w = session.class_map.shape if session.class_map is not None else session.bands["B04"].shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    if kind == "rgb":
        p_lo, p_hi = _rgb_stretch(session)
        bands = src["rgb"] if src else session.bands
        rgb = _rgb(bands, p_lo, p_hi)
        rgba[..., :3] = (rgb * 255).astype(np.uint8)
        rgba[..., 3] = np.where(np.isfinite(bands["B04"]), 255, 0)
    elif kind == "class":
        cmap = src["class_map"] if src else session.class_map
        rgba[:] = _palette_rgba(CLASS_COLORS)[_class_map_to_index(cmap)]
        rgba[cmap == -1, 3] = 0
    elif kind == "ndvi":
        if src is None and not session.indices:
            compute_indices(session)
        ndvi = src["ndvi"] if src else session.indices["ndvi"]
        norm = np.clip((np.nan_to_num(ndvi, nan=0.0) + 0.2) / 1.1, 0, 1)
        rgba[:] = (plt.get_cmap("RdYlGn")(norm) * 255).astype(np.uint8)
        rgba[~np.isfinite(ndvi), 3] = 0
    elif kind == "change":
        if src is None:
            raise ValueError("La capa de cambios requiere un año comparado.")
        codes = change_map(src["class_map"], session.class_map)
        rgba[:] = _palette_rgba([c for c, _ in CHANGE_LABELS])[codes]
        rgba[(codes == 0) | (codes == 5), 3] = 0
    else:
        raise ValueError(f"Capa '{kind}' no válida. Opciones: {LAYER_KINDS}.")

    buf = io.BytesIO()
    plt.imsave(buf, rgba, format="png")
    return buf.getvalue()
