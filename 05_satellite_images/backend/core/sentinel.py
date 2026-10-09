"""
core/sentinel.py
----------------
Utilidades compartidas para leer Sentinel-2 L2A desde Planetary Computer.

- Conjunto de bandas usado por toda la app y su resolución nativa.
- Conversión DN → reflectancia de superficie, considerando el offset de
  +1000 introducido por el processing baseline 04.00 (enero 2022).
- Máscara de nubes a partir de la Scene Classification Layer (SCL).
- Lectura de bandas: ventana nativa (escena principal) o reproyección
  directa sobre una grilla de referencia (escenas históricas).
"""

from __future__ import annotations

import os
from datetime import datetime

import numpy as np
import rasterio
import rasterio.warp
import rasterio.windows
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT

# ---------------------------------------------------------------------------
# Bandas
# ---------------------------------------------------------------------------

# Bandas espectrales en orden.  B04 (10 m) es la referencia de grilla.
BAND_SET = ["B02", "B03", "B04", "B05", "B06", "B07", "B08", "B11", "B12"]
RGB_BANDS = ["B04", "B03", "B02"]
SCL_ASSET = "SCL"

# Clases SCL consideradas inválidas:
# 0 sin datos, 1 saturado/defectuoso, 3 sombra de nube,
# 8 nube prob. media, 9 nube prob. alta, 10 cirros, 11 nieve/hielo.
SCL_INVALID = (0, 1, 3, 8, 9, 10, 11)

_BOA_OFFSET = 1000.0
_QUANTIFICATION = 10_000.0
_BASELINE_OFFSET_DATE = datetime(2022, 1, 25)

os.environ.setdefault("GDAL_HTTP_TIMEOUT", "60")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "0")
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")


# ---------------------------------------------------------------------------
# Radiometría
# ---------------------------------------------------------------------------

def boa_offset(item) -> float:
    """Offset aditivo de los DN del item (1000 para baseline >= 04.00, si no 0)."""
    baseline = (getattr(item, "properties", None) or {}).get("s2:processing_baseline")
    if baseline is not None:
        try:
            return _BOA_OFFSET if float(baseline) >= 4.0 else 0.0
        except (TypeError, ValueError):
            pass
    dt = getattr(item, "datetime", None)
    if dt is not None and dt.replace(tzinfo=None) >= _BASELINE_OFFSET_DATE:
        return _BOA_OFFSET
    return 0.0


def to_reflectance(dn: np.ndarray, offset: float) -> np.ndarray:
    """DN → reflectancia de superficie [0, 1].  DN = 0 (nodata) pasa a NaN."""
    out = (dn.astype(np.float32) - np.float32(offset)) / np.float32(_QUANTIFICATION)
    out[dn == 0] = np.nan
    return out


def cloud_mask_from_scl(scl: np.ndarray) -> np.ndarray:
    """True donde el píxel es nube, sombra, nieve o sin datos."""
    return np.isin(scl, SCL_INVALID)


# ---------------------------------------------------------------------------
# Lectura
# ---------------------------------------------------------------------------

def _bbox_in_crs(bbox_lonlat: list[float], crs) -> tuple[float, float, float, float]:
    lon_min, lat_min, lon_max, lat_max = bbox_lonlat
    xs, ys = rasterio.warp.transform(
        "EPSG:4326", crs, [lon_min, lon_max, lon_min, lon_max], [lat_min, lat_min, lat_max, lat_max]
    )
    return min(xs), min(ys), max(xs), max(ys)


def read_window(href: str, bbox_lonlat: list[float]) -> tuple[np.ndarray, object, object]:
    """Lee la ventana del bbox en resolución nativa → ``(data, crs, transform)``."""
    with rasterio.open(href) as src:
        x_min, y_min, x_max, y_max = _bbox_in_crs(bbox_lonlat, src.crs)
        window = rasterio.windows.from_bounds(x_min, y_min, x_max, y_max, transform=src.transform)
        window = window.round_offsets().round_lengths()
        data = src.read(1, window=window, boundless=True, fill_value=0)
        return data, src.crs, src.window_transform(window)


def read_on_grid(
    href: str,
    crs,
    transform,
    shape: tuple[int, int],
    resampling: Resampling = Resampling.bilinear,
) -> np.ndarray:
    """Lee un asset reproyectado exactamente sobre la grilla (crs, transform, shape)."""
    height, width = shape
    with rasterio.open(href) as src:
        with WarpedVRT(src, crs=crs, transform=transform, width=width, height=height,
                       resampling=resampling, src_nodata=0, nodata=0) as vrt:
            return vrt.read(1)


def read_thumbnail(href: str, bbox_lonlat: list[float], max_size: int = 256) -> np.ndarray:
    """Lee la ventana del bbox de un asset RGB (``visual``) decimada a ≤ max_size px."""
    with rasterio.open(href) as src:
        x_min, y_min, x_max, y_max = _bbox_in_crs(bbox_lonlat, src.crs)
        window = rasterio.windows.from_bounds(x_min, y_min, x_max, y_max, transform=src.transform)
        scale = max(window.width, window.height) / max_size
        out_h = max(1, int(window.height / max(scale, 1)))
        out_w = max(1, int(window.width / max(scale, 1)))
        data = src.read(
            indexes=[1, 2, 3], window=window, out_shape=(3, out_h, out_w),
            boundless=True, fill_value=0, resampling=Resampling.average,
        )
    return np.transpose(data, (1, 2, 0))


def local_cloud_fraction(item, bbox_lonlat: list[float], max_size: int = 128) -> float:
    """Fracción de píxeles inválidos (SCL) dentro del bbox, leída a baja resolución."""
    href = item.assets[SCL_ASSET].href
    with rasterio.open(href) as src:
        x_min, y_min, x_max, y_max = _bbox_in_crs(bbox_lonlat, src.crs)
        window = rasterio.windows.from_bounds(x_min, y_min, x_max, y_max, transform=src.transform)
        scale = max(window.width, window.height) / max_size
        out_h = max(1, int(window.height / max(scale, 1)))
        out_w = max(1, int(window.width / max(scale, 1)))
        scl = src.read(1, window=window, out_shape=(out_h, out_w), boundless=True,
                       fill_value=0, resampling=Resampling.nearest)
    return float(np.mean(cloud_mask_from_scl(scl)))


def grid_bounds_latlon(crs, transform, shape: tuple[int, int]) -> list[list[float]]:
    """Bounds de la grilla en EPSG:4326 como ``[[lat_min, lon_min], [lat_max, lon_max]]``."""
    h, w = shape
    xs = [transform.c, transform.c + transform.a * w]
    ys = [transform.f, transform.f + transform.e * h]
    lons, lats = rasterio.warp.transform(crs, "EPSG:4326", [xs[0], xs[1], xs[0], xs[1]],
                                         [ys[0], ys[0], ys[1], ys[1]])
    return [[min(lats), min(lons)], [max(lats), max(lons)]]
