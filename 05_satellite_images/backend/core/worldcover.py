"""
core/worldcover.py
------------------
Etiquetas de entrenamiento desde ESA WorldCover (10 m) en Planetary Computer.

WorldCover es un mapa global de cobertura validado por la ESA (exactitud global
≈ 76 % en 2021). Se usa como fuente de ejemplos para el Random Forest: el modelo
aprende la firma espectral de cada clase en la escena actual y luego la aplica
a la escena y a los años anteriores. Como el mapa es de 2021, los píxeles que
cambiaron desde entonces quedan mal etiquetados; con decenas de miles de
ejemplos ese ruido pesa poco, pero conviene recordarlo.
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
