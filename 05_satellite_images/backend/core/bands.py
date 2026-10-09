"""
core/bands.py
-------------
Descarga de bandas Sentinel-2 con windowed read (rasterio) y generación
del True Color Preview.

Requisitos cubiertos: 3.1, 3.2, 3.3, 3.6, 10.1, 10.2, 10.3, 10.4, 10.5
"""

from __future__ import annotations

import concurrent.futures
import io
import json
import time
from typing import Generator

import numpy as np
from rasterio.enums import Resampling

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from core.sentinel import (
    BAND_SET,
    SCL_ASSET,
    boa_offset,
    cloud_mask_from_scl,
    read_on_grid,
    read_window,
    to_reflectance,
)
from session_store import SessionData, get_session

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

_MAX_RETRIES = 2     # reintentos ante errores transitorios
_MAX_WORKERS = 6     # descargas simultáneas


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ndjson(stage: str, progress: float, message: str, **extra) -> str:
    """Serializa una línea NDJSON de progreso."""
    obj: dict = {"stage": stage, "progress": round(progress, 4), "message": message}
    obj.update(extra)
    return json.dumps(obj, ensure_ascii=False) + "\n"


def _with_retries(fn, *args, **kwargs):
    """Ejecuta *fn* con reintentos ante errores transitorios de red."""
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < _MAX_RETRIES:
                time.sleep(1)
    raise RuntimeError(f"{last_exc}") from last_exc


# ---------------------------------------------------------------------------
# Función principal de descarga
# ---------------------------------------------------------------------------

def download_bands_stream(
    session_id: str,
    item,
) -> Generator[str, None, None]:
    """
    Descarga el Band_Set y la capa SCL de la escena y los almacena en la Session.

    1. B04 se lee en su ventana nativa (10 m) y define la grilla de referencia.
    2. El resto de bandas (10/20 m) y la SCL se leen en paralelo reproyectadas
       directamente sobre esa grilla (bilineal para bandas, vecino más cercano
       para la SCL), lo que garantiza alineación exacta.
    3. Los DN se convierten a reflectancia de superficie y se construye la
       máscara de nubes.

    Emite líneas NDJSON ``{stage, progress, message}`` y una final ``stage="done"``.
    """
    session: SessionData | None = get_session(session_id)
    if session is None:
        yield _ndjson("error", 0.0, "Sesión no encontrada o expirada.",
                      error="session_not_found")
        return

    assets = [*BAND_SET, SCL_ASSET]
    missing = [a for a in assets if a not in item.assets]
    if missing:
        yield _ndjson("error", 0.0, f"Assets {missing} no encontrados en el item STAC.",
                      error="missing_assets")
        return

    n_total = len(assets)
    yield _ndjson("downloading", 0.0,
                  f"Iniciando descarga de {len(BAND_SET)} bandas + máscara SCL…")

    # 1. Banda de referencia
    yield _ndjson("downloading", 0.02, "Descargando B04 (grilla de referencia, 10 m)…")
    try:
        ref, ref_crs, ref_transform = _with_retries(read_window, item.assets["B04"].href, session.bbox)
    except Exception as exc:  # noqa: BLE001
        yield _ndjson("error", 0.02, f"Fallo al descargar B04: {exc}", error=str(exc))
        return
    ref_shape = ref.shape
    raw: dict[str, np.ndarray] = {"B04": ref}
    yield _ndjson("downloading", 1 / n_total * 0.9,
                  f"B04 descargada ({ref_shape[0]}×{ref_shape[1]} px).")

    # 2. Resto de assets en paralelo, alineados a la grilla de B04
    pending = [a for a in assets if a != "B04"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        futures = {
            pool.submit(
                _with_retries, read_on_grid, item.assets[a].href, ref_crs, ref_transform, ref_shape,
                Resampling.nearest if a == SCL_ASSET else Resampling.bilinear,
            ): a
            for a in pending
        }
        for fut in concurrent.futures.as_completed(futures):
            name = futures[fut]
            try:
                raw[name] = fut.result()
            except Exception as exc:  # noqa: BLE001
                for f in futures:
                    f.cancel()
                yield _ndjson("error", len(raw) / n_total * 0.9,
                              f"Fallo al descargar {name}: {exc}", error=str(exc))
                return
            yield _ndjson("downloading", len(raw) / n_total * 0.9,
                          f"{name} descargada ({len(raw)}/{n_total}).")

    # 3. Reflectancia + máscara de nubes
    yield _ndjson("resampling", 0.92, "Convirtiendo a reflectancia y aplicando máscara SCL…")
    offset = boa_offset(item)
    cloud_mask = cloud_mask_from_scl(raw[SCL_ASSET])
    session.bands = {b: to_reflectance(raw[b], offset) for b in BAND_SET}
    session.cloud_mask = cloud_mask
    session.cloud_fraction = float(cloud_mask.mean())
    session.crs = ref_crs
    session.transform = ref_transform
    session.indices = {}

    yield _ndjson(
        "done", 1.0,
        f"Descarga completada. Nubes/sombras en la zona: {session.cloud_fraction * 100:.1f} %.",
        scene_id=session.scene_id,
        cloud_fraction=session.cloud_fraction,
        shape=list(ref_shape),
    )


# ---------------------------------------------------------------------------
# True Color Preview
# ---------------------------------------------------------------------------

def generate_true_color(session: SessionData) -> bytes:
    """
    Genera un True Color Preview (PNG) a partir de las bandas B04, B03 y B02
    de la Session, normalizando por percentiles (2, 98) para estirar el
    contraste.

    Parameters
    ----------
    session : SessionData
        Session con las bandas ya descargadas.

    Returns
    -------
    bytes
        Imagen PNG codificada como bytes.

    Raises
    ------
    ValueError
        Si alguna de las bandas B02, B03 o B04 no está disponible en la Session.
    """
    for band in ("B04", "B03", "B02"):
        if band not in session.bands:
            raise ValueError(
                f"La banda {band} no está disponible en la sesión. "
                "Descargue las bandas antes de generar el preview."
            )

    def _normalize(arr: np.ndarray) -> np.ndarray:
        """Normaliza al rango [0, 1] usando percentiles (2, 98)."""
        p2 = float(np.nanpercentile(arr, 2))
        p98 = float(np.nanpercentile(arr, 98))
        if p98 == p2:
            return np.zeros_like(arr, dtype=np.float32)
        normed = (arr - p2) / (p98 - p2)
        return np.nan_to_num(np.clip(normed, 0.0, 1.0), nan=0.0).astype(np.float32)

    r = _normalize(session.bands["B04"])
    g = _normalize(session.bands["B03"])
    b = _normalize(session.bands["B02"])

    # Apilar en (H, W, 3)
    rgb = np.stack([r, g, b], axis=-1)

    fig, ax = plt.subplots(figsize=(8, 8), dpi=100)
    ax.imshow(rgb)
    ax.axis("off")
    plt.tight_layout(pad=0)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0)
    plt.close(fig)
    buf.seek(0)
    return buf.read()
