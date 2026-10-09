"""
core/region.py
--------------
Contorno de Colombia, usado como referencia en el mapa (la app no restringe
la zona de análisis a este territorio).

El contorno proviene de Natural Earth v5.1.2 (dominio público): territorio
continental a escala 1:50m más San Andrés, Providencia y Malpelo a 1:10m.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from matplotlib.path import Path as MplPath

REGION_NAME = "Colombia"
_GEOJSON = Path(__file__).resolve().parent.parent / "resources" / "colombia.geojson"


@lru_cache(maxsize=1)
def region_geojson() -> dict:
    return json.loads(_GEOJSON.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _outer_rings() -> list[MplPath]:
    geom = region_geojson()["features"][0]["geometry"]
    return [MplPath(poly[0]) for poly in geom["coordinates"]]


@lru_cache(maxsize=1)
def region_bounds() -> list[float]:
    """``[lon_min, lat_min, lon_max, lat_max]`` del contorno."""
    xs, ys = [], []
    for ring in _outer_rings():
        xs.extend(ring.vertices[:, 0])
        ys.extend(ring.vertices[:, 1])
    return [float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))]


def contains(lon: float, lat: float) -> bool:
    """True si el punto (lon, lat) está dentro de Colombia (incluye islas)."""
    return any(ring.contains_point((lon, lat)) for ring in _outer_rings())
