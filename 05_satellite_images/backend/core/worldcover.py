"""
core/worldcover.py
------------------
Etiquetas de entrenamiento desde ESA WorldCover (10 m) en Planetary Computer.

WorldCover es un mapa global de cobertura validado por la ESA (exactitud global
≈ 76 % en 2021). Se usa como fuente de ejemplos para el Random Forest: el modelo
aprende la firma espectral de cada clase en la escena actual y luego la aplica
a la escena y a los años anteriores. Como el mapa es de 2021, los píxeles que
cambiaron desde entonces quedan mal etiquetados; con decenas de miles de
ejemplos ese ruido pesa poco, salvo cuando es sistemático (un río que migró se
etiqueta entero como pastos): por eso ``clean_labels`` descarta las etiquetas
que contradicen la firma espectral de la escena antes de entrenar.
"""

from __future__ import annotations

import concurrent.futures

import numpy as np
import planetary_computer
import pystac_client
from rasterio.enums import Resampling

from core.sentinel import read_on_grid

_STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
_COLLECTION = "esa-worldcover"
WORLDCOVER_YEAR = 2021

# Clase WorldCover → código del esquema «worldcover» (core/classes.py)
WC_TO_CLASS: dict[int, int] = {
    10: 0,   # cobertura arbórea → bosque
    95: 0,   # manglares → bosque
    80: 1,   # cuerpos de agua permanentes → agua
    60: 2,   # suelo desnudo / vegetación escasa → suelo expuesto / minería
    50: 3,   # construido → urbano
    20: 4,   # arbustales → pastos y cultivos
    30: 4,   # pastizales
    40: 4,   # cultivos
    90: 4,   # humedal herbáceo
    # 70 (nieve) y 100 (musgos y líquenes) quedan fuera del entrenamiento
}


_FOREST, _WATER = 0, 1

# Consistencia espectral de las etiquetas (clean_labels). WorldCover es de 2021 y
# la escena no: un río que migró, un cauce minero nuevo o un bosque talado dejan
# etiquetas que contradicen lo que el satélite ve hoy. Si el modelo aprende de
# ellas, el agua turbia pasa a ser «pastos» y deja de reconocerse en otras fechas.
WATER_LIKE_MNDWI = 0.3     # agua abierta evidente: MNDWI alto…
WATER_LIKE_NDVI = 0.2      # …y sin vegetación
WATER_LABEL_MNDWI_MIN = 0.0  # una etiqueta «agua» necesita al menos firma de agua
WATER_LABEL_NDVI_MAX = 0.3
FOREST_LABEL_NDVI_MIN = 0.4  # una etiqueta «bosque» necesita dosel verde


def clean_labels(labels: np.ndarray, indices: dict) -> tuple[np.ndarray, int]:
    """Descarta (-1) las etiquetas que contradicen la escena; devuelve (etiquetas, descartadas).

    - Agua evidente (MNDWI > 0.3 y NDVI < 0.2) etiquetada como otra clase.
    - «Agua» sin firma de agua (MNDWI ≤ 0 o NDVI ≥ 0.3): cauce abandonado o rellenado.
    - «Bosque» sin dosel (NDVI < 0.4): talado desde 2021 o fecha seca.

    Se descartan en vez de reetiquetarse: el modelo solo aprende de ejemplos en que
    el mapa y la imagen coinciden. Los píxeles sin índices (nube) quedan igual.
    """
    mndwi, ndvi = indices["mndwi"], indices["ndvi"]
    seen = np.isfinite(mndwi) & np.isfinite(ndvi)
    with np.errstate(invalid="ignore"):
        water_like = (mndwi > WATER_LIKE_MNDWI) & (ndvi < WATER_LIKE_NDVI)
        bad = (
            ((labels != _WATER) & water_like)
            | ((labels == _WATER) & ~((mndwi > WATER_LABEL_MNDWI_MIN) & (ndvi < WATER_LABEL_NDVI_MAX)))
            | ((labels == _FOREST) & (ndvi < FOREST_LABEL_NDVI_MIN))
        )
    bad &= seen & (labels >= 0)
    out = labels.copy()
    out[bad] = -1
    return out, int(np.count_nonzero(bad))


class WorldCoverError(RuntimeError):
    """No se pudo obtener WorldCover para la zona."""


def _items(bbox: list[float], timeout: int = 30) -> list:
    def search():
        client = pystac_client.Client.open(_STAC_URL, modifier=planetary_computer.sign_inplace)
        return list(client.search(
            collections=[_COLLECTION], bbox=bbox, datetime=f"{WORLDCOVER_YEAR}-01-01/{WORLDCOVER_YEAR}-12-31",
        ).items())

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        try:
            return pool.submit(search).result(timeout=timeout)
        except concurrent.futures.TimeoutError as exc:
            raise WorldCoverError("El catálogo no respondió a tiempo al buscar WorldCover.") from exc
        except Exception as exc:  # noqa: BLE001
            raise WorldCoverError(f"No se pudo consultar WorldCover: {exc}") from exc


def worldcover_labels(bbox: list[float], crs, transform, shape: tuple[int, int]) -> np.ndarray:
    """Etiquetas (int16, -1 = sin etiqueta) sobre la grilla de la escena.

    Si la zona cruza el borde de una tesela de WorldCover (3° × 3°), se combinan
    todas las teselas que la cubren.
    """
    items = _items(bbox)
    if not items:
        raise WorldCoverError("WorldCover no cubre esta zona.")
    raw = np.zeros(shape, dtype=np.uint8)
    for item in items:
        data = read_on_grid(item.assets["map"].href, crs, transform, shape, Resampling.nearest)
        raw = np.where(raw == 0, data, raw)
    labels = np.full(shape, -1, dtype=np.int16)
    for wc, code in WC_TO_CLASS.items():
        labels[raw == wc] = code
    return labels
