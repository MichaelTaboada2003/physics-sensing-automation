"""
core/thermal.py
---------------
Temperatura de la superficie terrestre (LST) con Landsat 8/9 Collection 2 Level-2.

Sentinel-2 no tiene banda térmica, así que el calor se mide con Landsat:

- Producto: ``landsat-c2-l2`` (Planetary Computer), banda ST_B10 (``lwir11``),
  temperatura de superficie en kelvin = DN · 0.00341802 + 149.0.  Se pasa a °C.
- Resolución: el sensor TIRS mide a 100 m; USGS entrega el producto remuestreado
  a 30 m.  Aquí se reproyecta sobre la grilla de 10 m de la sesión, de modo que
  cada píxel de cobertura tiene «su» temperatura, pero el detalle real es ~100 m.
- Hora: Landsat pasa sobre Colombia hacia las 10:30 a. m. hora local; es la
  temperatura de la *superficie* (techos, copas, suelo), no la del aire.
- Nubes: QA_PIXEL; se descartan relleno, nubes, nubes dilatadas, cirros, sombras
  y nieve.
- Escena: la de menos nubes *dentro de la zona* en ±60 días alrededor de la fecha
  de la escena Sentinel-2 (misma época), con el año completo como respaldo.

Calor y deforestación (``deforestation_heat``): compara los píxeles que perdieron
la clase principal de vegetación entre dos años con los que la conservaron.  La
cifra central es una diferencia de diferencias,

    (ΔLST de lo deforestado) − (ΔLST del bosque conservado),

que descuenta el día más cálido o más frío de cada escena: ambos grupos comparten
la misma pareja de fechas.  El intervalo del 95 % sale de un bootstrap por
bloques de 300 m, porque los píxeles vecinos no son independientes (la banda
térmica mide a 100 m).
"""

from __future__ import annotations

import concurrent.futures
import io
import time
from datetime import datetime

import numpy as np
import planetary_computer
import pystac_client
import rasterio
import rasterio.windows
from rasterio.enums import Resampling

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from core.classes import primary, scheme
from core.compare import pixel_area_m2, scene_year, seasonal_time_range
from core.sentinel import _bbox_in_crs, read_on_grid
from session_store import SessionData

_STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
_COLLECTION = "landsat-c2-l2"
_PLATFORMS = ["landsat-8", "landsat-9"]
FIRST_YEAR = 2013  # Landsat 8 entra en operación en abril de 2013

ST_SCALE = 0.00341802
ST_OFFSET = 149.0
KELVIN = 273.15
# QA_PIXEL: bit 0 relleno, 1 nube dilatada, 2 cirros, 3 nube, 4 sombra, 5 nieve
QA_INVALID_BITS = 0b111111

MAX_CANDIDATES = 6          # escenas evaluadas por nubosidad local
GOOD_ENOUGH_CLEAR = 0.95    # deja de buscar si la zona está despejada a este nivel
MIN_CLEAR = 0.30            # por debajo, la escena no sirve para la zona
BLOCK_M = 300.0             # tamaño del bloque del bootstrap
N_BOOT = 1000
MIN_GROUP_PIXELS = 100      # píxeles mínimos por grupo (1 ha a 10 m)
MIN_GROUP_BLOCKS = 5
MIN_CLASS_PIXELS = 100


class ThermalError(RuntimeError):
    """No se pudo obtener temperatura de superficie para la zona o el año."""


# ---------------------------------------------------------------------------
# Conversión
# ---------------------------------------------------------------------------

def qa_invalid(qa: np.ndarray) -> np.ndarray:
    """True donde QA_PIXEL marca relleno, nube, nube dilatada, cirros, sombra o nieve."""
    return (qa.astype(np.uint16) & QA_INVALID_BITS) != 0


def st_to_celsius(dn: np.ndarray, invalid: np.ndarray | None = None) -> np.ndarray:
    """DN de ST_B10 → °C (float32); DN = 0 y píxeles inválidos pasan a NaN."""
    out = (dn.astype(np.float32) * np.float32(ST_SCALE) + np.float32(ST_OFFSET - KELVIN))
    out[dn == 0] = np.nan
    if invalid is not None:
        out[invalid] = np.nan
    # Valores físicamente imposibles en superficie (residuos de borde o nube sin marcar)
    out[(out < -30) | (out > 80)] = np.nan
    return out


# ---------------------------------------------------------------------------
# Búsqueda de escena
# ---------------------------------------------------------------------------

def _search(bbox: list[float], time_range: str, timeout: int = 30) -> list:
    def run():
        client = pystac_client.Client.open(_STAC_URL, modifier=planetary_computer.sign_inplace)
        items = list(client.search(
            collections=[_COLLECTION], bbox=bbox, datetime=time_range,
            query={"platform": {"in": _PLATFORMS}, "eo:cloud_cover": {"lt": 80}},
        ).items())
        return sorted(items, key=lambda it: it.properties.get("eo:cloud_cover", 100))

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        try:
            return pool.submit(run).result(timeout=timeout)
        except concurrent.futures.TimeoutError as exc:
            raise ThermalError("El catálogo de Landsat no respondió a tiempo.") from exc
        except Exception as exc:  # noqa: BLE001
            raise ThermalError(f"No se pudo consultar Landsat: {exc}") from exc


def local_clear_fraction(item, bbox: list[float], max_size: int = 96) -> float:
    """Fracción despejada (QA_PIXEL) dentro del bbox, leída a baja resolución."""
    with rasterio.open(item.assets["qa_pixel"].href) as src:
        x_min, y_min, x_max, y_max = _bbox_in_crs(bbox, src.crs)
        window = rasterio.windows.from_bounds(x_min, y_min, x_max, y_max, transform=src.transform)
        scale = max(window.width, window.height) / max_size
        out_h = max(1, int(window.height / max(scale, 1)))
        out_w = max(1, int(window.width / max(scale, 1)))
        qa = src.read(1, window=window, out_shape=(out_h, out_w), boundless=True,
                      fill_value=1, resampling=Resampling.nearest)
    return float(np.mean(~qa_invalid(qa)))


def best_landsat_scene(bbox: list[float], scene_dt: datetime, year: int, report=lambda _m: None) -> dict:
    """Escena Landsat con menos nubes en la zona para *year* (misma época que *scene_dt*)."""
    if year < FIRST_YEAR:
        raise ThermalError(f"{year}: Landsat 8 empezó a operar en 2013; no hay temperatura antes.")
    for time_range in (seasonal_time_range(scene_dt, year), f"{year}-01-01/{year}-12-31"):
        report(f"{year}: buscando escenas Landsat ({time_range})…")
        items = _search(bbox, time_range)
        best, best_clear = None, -1.0
        for item in items[:MAX_CANDIDATES]:
            try:
                clear = local_clear_fraction(item, bbox)
            except Exception:  # noqa: BLE001 — una escena ilegible no detiene la búsqueda
                continue
            if clear > best_clear:
                best, best_clear = item, clear
            if clear >= GOOD_ENOUGH_CLEAR:
                break
        if best is not None and best_clear >= MIN_CLEAR:
            return {"item": best, "local_clear": best_clear}
    raise ThermalError(f"{year}: no hay escenas Landsat con al menos {MIN_CLEAR:.0%} de la zona despejada.")


# ---------------------------------------------------------------------------
# Temperatura de un año
# ---------------------------------------------------------------------------

def process_heat_year(session: SessionData, year: int, report=lambda _m: None) -> dict:
    """Busca, descarga y convierte la LST de *year* sobre la grilla de la sesión.

    Guarda el resultado en ``session.heat[year]`` y lo devuelve.
    """
    scene_dt = datetime.fromisoformat(session.scene_datetime)
    found = best_landsat_scene(session.bbox, scene_dt, year, report)
    item = found["item"]
    report(
        f"{year}: Landsat {item.datetime:%Y-%m-%d} ({item.properties.get('platform', '')}, "
        f"{100 * found['local_clear']:.0f} % de la zona despejada)"
    )
    shape = session.bands["B04"].shape

    def _read(asset: str) -> np.ndarray:
        last: Exception | None = None
        for _ in range(3):
            try:
                return read_on_grid(
                    item.assets[asset].href, session.crs, session.transform, shape,
                    Resampling.nearest if asset == "qa_pixel" else Resampling.bilinear,
                )
            except Exception as exc:  # noqa: BLE001
                last = exc
                time.sleep(1)
        raise ThermalError(f"{year}: fallo al descargar {asset} — {last}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        st, qa = pool.map(_read, ["lwir11", "qa_pixel"])
    lst = st_to_celsius(st, qa_invalid(qa))
    entry = {
        "scene": {
            "id": item.id,
            "datetime": item.datetime.isoformat(),
            "platform": item.properties.get("platform"),
            "cloud_cover": item.properties.get("eo:cloud_cover"),
            "local_clear": round(100 * found["local_clear"], 1),
        },
        "lst": lst,
        "clear_percent": round(100.0 * float(np.isfinite(lst).mean()), 1),
    }
    session.heat[year] = entry
    return entry


# ---------------------------------------------------------------------------
# Estadísticas
# ---------------------------------------------------------------------------

def _describe(values: np.ndarray) -> dict | None:
    v = values[np.isfinite(values)]
    if v.size == 0:
        return None
    p10, p50, p90 = np.percentile(v, [10, 50, 90])
    return {
        "mean": round(float(v.mean()), 2), "median": round(float(p50), 2),
        "p10": round(float(p10), 2), "p90": round(float(p90), 2), "pixels": int(v.size),
    }


def color_range(session: SessionData) -> tuple[float, float]:
    """Rango fijo de la escala de color: percentiles 2–98 de todos los años cargados."""
    vals = np.concatenate([e["lst"][np.isfinite(e["lst"])] for e in session.heat.values()] or [np.array([])])
    if vals.size == 0:
        return 20.0, 40.0
    lo, hi = np.percentile(vals, [2, 98])
    if hi - lo < 1:
        lo, hi = lo - 0.5, hi + 0.5
    return round(float(lo), 1), round(float(hi), 1)


def by_class(lst: np.ndarray, class_map: np.ndarray | None, scheme_name: str, area_m2: float) -> list[dict]:
    """Temperatura por clase de cobertura (clases con al menos 1 ha medida)."""
    if class_map is None:
        return []
    out = []
    for c in scheme(scheme_name):
        d = _describe(lst[class_map == c.code])
        if d is None or d["pixels"] < MIN_CLASS_PIXELS:
            continue
        out.append({"key": c.key, "label": c.label, "color": c.color, **d,
                    "hectares": round(d["pixels"] * area_m2 / 10_000, 2)})
    return out


def trend_surface(values: np.ndarray, ref: np.ndarray, max_points: int = 50_000) -> np.ndarray:
    """Superficie cuadrática ajustada a *values* sobre los píxeles *ref*.

    Entre dos fechas la atmósfera cambia de forma suave a lo ancho de la escena
    (humedad, bruma); esa tendencia de gran escala no es efecto de la cobertura.
    Restarla deja solo los contrastes locales.  Sin puntos suficientes devuelve
    la mediana (constante).
    """
    h, w = values.shape
    ok = ref & np.isfinite(values)
    rows, cols = np.nonzero(ok)
    if rows.size < 50:
        finite = values[np.isfinite(values)]
        return np.full(values.shape, np.median(finite) if finite.size else 0.0, dtype=np.float32)
    if rows.size > max_points:
        pick = np.random.default_rng(0).choice(rows.size, max_points, replace=False)
        rows, cols = rows[pick], cols[pick]
    y, x = rows / max(h - 1, 1), cols / max(w - 1, 1)
    A = np.column_stack([np.ones_like(x), x, y, x * x, x * y, y * y])
    coef, *_ = np.linalg.lstsq(A, values[rows, cols], rcond=None)
    yy, xx = np.mgrid[0:h, 0:w]
    yy, xx = yy / max(h - 1, 1), xx / max(w - 1, 1)
    return (coef[0] + coef[1] * xx + coef[2] * yy + coef[3] * xx * xx
            + coef[4] * xx * yy + coef[5] * yy * yy).astype(np.float32)


def _block_ids(shape: tuple[int, int], block_px: int) -> np.ndarray:
    h, w = shape
    rows = np.arange(h) // block_px
    cols = np.arange(w) // block_px
    n_cols = int(cols.max()) + 1 if w else 1
    return rows[:, None] * n_cols + cols[None, :]


def deforestation_heat(
    lst_now: np.ndarray, lst_past: np.ndarray, past_cls: np.ndarray, cur_cls: np.ndarray,
    block_px: int, area_m2: float, rng: np.random.Generator | None = None,
) -> dict:
    """Calor en lo deforestado vs. lo conservado entre dos años.

    - ``lost``: clase principal (código 0) en el pasado y otra clase hoy.
    - ``kept``: clase principal en ambos años.
    Devuelve medias por grupo, la diferencia actual (lost − kept) y la diferencia
    de diferencias de ΔLST, ambas con IC 95 % por bootstrap de bloques.  Antes de
    comparar, a ΔLST se le resta la tendencia de gran escala del bosque conservado
    (:func:`trend_surface`), para que un gradiente atmosférico de la escena no se
    confunda con el efecto de la deforestación.
    """
    valid = np.isfinite(lst_now) & np.isfinite(lst_past)
    lost = valid & (past_cls == 0) & (cur_cls != 0) & (cur_cls != -1)
    kept = valid & (past_cls == 0) & (cur_cls == 0)
    blocks = _block_ids(lst_now.shape, block_px)
    n_lost, n_kept = int(lost.sum()), int(kept.sum())
    base = {
        "lost_pixels": n_lost, "kept_pixels": n_kept,
        "lost_hectares": round(n_lost * area_m2 / 10_000, 2),
        "kept_hectares": round(n_kept * area_m2 / 10_000, 2),
    }
    lost_blocks = np.unique(blocks[lost])
    if n_lost < MIN_GROUP_PIXELS or n_kept < MIN_GROUP_PIXELS or lost_blocks.size < MIN_GROUP_BLOCKS:
        return {**base, "enough": False}

    delta = lst_now - lst_past
    resid = delta - trend_surface(delta, kept)
    n_blocks = int(blocks.max()) + 1

    def sums(mask: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        b = blocks[mask]
        return (np.bincount(b, weights=values[mask], minlength=n_blocks),
                np.bincount(b, minlength=n_blocks).astype(float))

    s_now_l, c_l = sums(lost, lst_now)
    s_now_k, c_k = sums(kept, lst_now)
    s_d_l, _ = sums(lost, delta)
    s_d_k, _ = sums(kept, delta)
    s_r_l, _ = sums(lost, resid)
    s_r_k, _ = sums(kept, resid)
    used = np.flatnonzero((c_l + c_k) > 0)

    def stat(idx: np.ndarray) -> tuple[float, float]:
        cl, ck = c_l[idx].sum(), c_k[idx].sum()
        if cl == 0 or ck == 0:
            return np.nan, np.nan
        now = s_now_l[idx].sum() / cl - s_now_k[idx].sum() / ck
        did = s_r_l[idx].sum() / cl - s_r_k[idx].sum() / ck
        return now, did

    now_diff, did = stat(used)
    rng = rng or np.random.default_rng(0)
    boots = np.array([stat(rng.choice(used, size=used.size, replace=True)) for _ in range(N_BOOT)])
    boots = boots[np.isfinite(boots).all(axis=1)]
    now_lo, now_hi = np.percentile(boots[:, 0], [2.5, 97.5])
    did_lo, did_hi = np.percentile(boots[:, 1], [2.5, 97.5])

    def r(x: float) -> float:
        return round(float(x), 2)

    return {
        **base, "enough": True,
        "lost_now_mean": r(s_now_l.sum() / c_l.sum()),
        "kept_now_mean": r(s_now_k.sum() / c_k.sum()),
        "lost_delta_mean": r(s_d_l.sum() / c_l.sum()),
        "kept_delta_mean": r(s_d_k.sum() / c_k.sum()),
        "now_diff": r(now_diff), "now_diff_low": r(now_lo), "now_diff_high": r(now_hi),
        "did": r(did), "did_low": r(did_lo), "did_high": r(did_hi),
        "significant": bool(did_lo > 0 or did_hi < 0),
        "blocks": int(used.size), "block_m": BLOCK_M,
    }


def heat_summary(session: SessionData, year: int | None = None) -> dict:
    """Resumen de calor de la escena actual y, si se pide, contra *year*."""
    cur_year = scene_year(session)
    cur = session.heat[cur_year]
    area = pixel_area_m2(session)
    vmin, vmax = color_range(session)
    out: dict = {
        "year": cur_year,
        "scene": cur["scene"],
        "clear_percent": cur["clear_percent"],
        "overall": _describe(cur["lst"]),
        "by_class": by_class(cur["lst"], session.class_map, session.class_scheme, area),
        "range": [vmin, vmax],
        "primary": {"key": primary(session.class_scheme).key, "label": primary(session.class_scheme).label},
        "years": sorted(session.heat),
        "ramp": ramp_stops("lst"),
        "delta_ramp": ramp_stops("delta"),
        "past": None,
        "delta_range": None,
        "deforestation": None,
    }
    if year is not None and year in session.heat:
        past = session.heat[year]
        out["past"] = {
            "year": year, "scene": past["scene"], "clear_percent": past["clear_percent"],
            "overall": _describe(past["lst"]),
        }
        comp = session.comparisons.get(year)
        if comp is not None and session.class_map is not None:
            block_px = max(1, int(round(BLOCK_M / np.sqrt(area))))
            out["delta_range"] = delta_range(session, year)
            out["deforestation"] = {
                "year": year,
                **deforestation_heat(cur["lst"], past["lst"], comp["class_map"], session.class_map,
                                     block_px, area),
            }
    return out


# ---------------------------------------------------------------------------
# Capas
# ---------------------------------------------------------------------------

HEAT_CMAP = "YlOrBr"      # secuencial cálido; no usa el rojo reservado al cambio significativo
DELTA_CMAP = "PuOr_r"     # divergente: morado = se enfrió, naranja = se calentó; gris al centro
HEAT_LAYER_KINDS = ("lst", "delta")


def delta_anomaly(session: SessionData, year: int) -> np.ndarray:
    """ΔLST (actual − *year*) relativo a la referencia: el bosque conservado.

    Se resta la tendencia de gran escala del ΔLST de los píxeles que eran y siguen
    siendo de la clase principal (o de toda la zona si no hay comparativa), de modo
    que 0 = «cambió igual que el bosque que se mantuvo».
    """
    d = session.heat[scene_year(session)]["lst"] - session.heat[year]["lst"]
    comp = session.comparisons.get(year)
    if comp is not None and session.class_map is not None:
        ref = (comp["class_map"] == 0) & (session.class_map == 0)
    else:
        ref = np.isfinite(d)
    return d - trend_surface(d, ref)


def delta_range(session: SessionData, year: int) -> float:
    d = delta_anomaly(session, year)
    finite = np.abs(d[np.isfinite(d)])
    return round(float(max(1.0, np.percentile(finite, 98))), 1) if finite.size else 1.0


def render_heat_layer(session: SessionData, kind: str, year: int | None = None) -> bytes:
    """PNG RGBA alineado a la grilla de la sesión.

    ``lst``: temperatura de *year* (o la actual) con la escala fija de la sesión.
    ``delta``: calentamiento relativo entre *year* y la escena actual.
    """
    if kind == "lst":
        lst = session.heat[year if year is not None else scene_year(session)]["lst"]
        vmin, vmax = color_range(session)
        norm = np.clip((np.nan_to_num(lst, nan=vmin) - vmin) / (vmax - vmin), 0, 1)
        rgba = (plt.get_cmap(HEAT_CMAP)(norm) * 255).astype(np.uint8)
        rgba[~np.isfinite(lst), 3] = 0
    elif kind == "delta":
        if year is None:
            raise ValueError("La capa de calentamiento requiere un año comparado.")
        d = delta_anomaly(session, year)
        lim = delta_range(session, year)
        norm = np.clip((np.nan_to_num(d, nan=0.0) + lim) / (2 * lim), 0, 1)
        rgba = (plt.get_cmap(DELTA_CMAP)(norm) * 255).astype(np.uint8)
        rgba[~np.isfinite(d), 3] = 0
    else:
        raise ValueError(f"Capa '{kind}' no válida. Opciones: {HEAT_LAYER_KINDS}.")
    buf = io.BytesIO()
    plt.imsave(buf, rgba, format="png")
    return buf.getvalue()


def ramp_stops(kind: str, n: int = 7) -> list[str]:
    """Colores de la rampa para la leyenda del frontend."""
    cmap = plt.get_cmap(HEAT_CMAP if kind == "lst" else DELTA_CMAP)
    return [matplotlib.colors.to_hex(cmap(i / (n - 1))) for i in range(n)]


# ---------------------------------------------------------------------------
# Progress_Stream
# ---------------------------------------------------------------------------

def heat_stream(session_id: str, year: int | None = None):
    """Procesa la LST actual (y la de *year* con su comparativa si faltan) y emite NDJSON.

    La línea ``done`` lleva ``heat`` = :func:`heat_summary`.
    """
    import queue
    import threading

    from core.compare import YearError, _check_session, _drain, _ndjson, process_year

    session, err = _check_session(session_id)
    if err:
        yield err
        return

    start = time.monotonic()
    cur_year = scene_year(session)
    q: "queue.Queue[str]" = queue.Queue()
    done = threading.Event()
    result: dict = {}
    steps = [0]

    def report(msg: str):
        steps[0] += 1
        q.put(msg)

    def _worker():
        try:
            if cur_year not in session.heat:
                process_heat_year(session, cur_year, report)
            if year is not None:
                if year not in session.comparisons:
                    report(f"{year}: falta la cobertura de ese año, clasificándola…")
                    process_year(session, year, report)
                if year not in session.heat:
                    process_heat_year(session, year, report)
        except (ThermalError, YearError) as exc:
            result["error"] = str(exc)
        except Exception as exc:  # noqa: BLE001
            result["error"] = f"Error inesperado al calcular la temperatura — {exc}"
        finally:
            done.set()

    threading.Thread(target=_worker, daemon=True).start()
    yield _ndjson("searching", 0.02, "Buscando temperatura de superficie (Landsat 8/9)…")
    yield from _drain(q, done, lambda: min(0.95, 0.05 + 0.12 * steps[0]), "processing")

    if "error" in result:
        yield _ndjson("error", 0.5, result["error"], error=result["error"])
        return
    elapsed = time.monotonic() - start
    yield _ndjson("done", 1.0, f"Temperatura lista en {elapsed:.1f} s.", heat=heat_summary(session, year))
