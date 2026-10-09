# core/indices.py
# Cálculo de índices espectrales NDVI, BSI, NDWI y renderizado de Index_Layer.
# Requisitos: 4.1, 4.2, 4.3

from __future__ import annotations

import io
from typing import TYPE_CHECKING

import matplotlib
matplotlib.use("Agg")  # backend sin pantalla
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import numpy as np

if TYPE_CHECKING:
    from session_store import SessionData

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

SENTINEL_VALUE: float = -9999.0  # valor fuera de rango para NaN/Inf

COLORMAPS: dict[str, str] = {
    "ndvi":  "RdYlGn",
    "bsi":   "YlOrBr",
    "ndwi":  "Blues",
    "mndwi": "PuBu",
    "ndbi":  "OrRd",
    "evi":   "YlGn",
    "savi":  "BrBG",
}

# Orden fijo de los índices (también es el orden de features del clasificador)
INDEX_NAMES: tuple[str, ...] = tuple(COLORMAPS)


# ---------------------------------------------------------------------------
# Helpers de cálculo (expuestos para PBT)
# ---------------------------------------------------------------------------

def compute_ndvi(b08: np.ndarray, b04: np.ndarray) -> np.ndarray:
    """NDVI = (B08 − B04) / (B08 + B04).

    Division by zero produces NaN (via numpy's float division).
    """
    b08 = b08.astype(np.float32)
    b04 = b04.astype(np.float32)
    with np.errstate(divide="ignore", invalid="ignore"):
        result = (b08 - b04) / (b08 + b04)
    return result.astype(np.float32)


def compute_bsi(
    b11: np.ndarray,
    b04: np.ndarray,
    b08: np.ndarray,
    b02: np.ndarray,
) -> np.ndarray:
    """BSI = ((B11 + B04) − (B08 + B02)) / ((B11 + B04) + (B08 + B02))."""
    b11 = b11.astype(np.float32)
    b04 = b04.astype(np.float32)
    b08 = b08.astype(np.float32)
    b02 = b02.astype(np.float32)
    with np.errstate(divide="ignore", invalid="ignore"):
        numerator = (b11 + b04) - (b08 + b02)
        denominator = (b11 + b04) + (b08 + b02)
        result = numerator / denominator
    return result.astype(np.float32)


def compute_ndwi(b03: np.ndarray, b08: np.ndarray) -> np.ndarray:
    """NDWI = (B03 − B08) / (B03 + B08)."""
    b03 = b03.astype(np.float32)
    b08 = b08.astype(np.float32)
    with np.errstate(divide="ignore", invalid="ignore"):
        result = (b03 - b08) / (b03 + b08)
    return result.astype(np.float32)


def _normalized_difference(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a = a.astype(np.float32)
    b = b.astype(np.float32)
    with np.errstate(divide="ignore", invalid="ignore"):
        return ((a - b) / (a + b)).astype(np.float32)


def compute_mndwi(b03: np.ndarray, b11: np.ndarray) -> np.ndarray:
    """MNDWI = (B03 − B11) / (B03 + B11) — agua, robusto frente a suelo urbano."""
    return _normalized_difference(b03, b11)


def compute_ndbi(b11: np.ndarray, b08: np.ndarray) -> np.ndarray:
    """NDBI = (B11 − B08) / (B11 + B08) — superficies construidas / suelo."""
    return _normalized_difference(b11, b08)


def compute_evi(b08: np.ndarray, b04: np.ndarray, b02: np.ndarray) -> np.ndarray:
    """EVI = 2.5 (B08 − B04) / (B08 + 6 B04 − 7.5 B02 + 1).  Requiere reflectancia [0, 1]."""
    with np.errstate(divide="ignore", invalid="ignore"):
        evi = 2.5 * (b08 - b04) / (b08 + 6.0 * b04 - 7.5 * b02 + 1.0)
    return np.clip(evi, -1.0, 1.0).astype(np.float32)


def compute_savi(b08: np.ndarray, b04: np.ndarray, L: float = 0.5) -> np.ndarray:
    """SAVI = (1 + L)(B08 − B04) / (B08 + B04 + L).  Requiere reflectancia [0, 1]."""
    with np.errstate(divide="ignore", invalid="ignore"):
        return ((1.0 + L) * (b08 - b04) / (b08 + b04 + L)).astype(np.float32)


def compute_all_indices(bands: dict, mask: np.ndarray | None = None) -> dict[str, np.ndarray]:
    """Calcula todos los índices de ``INDEX_NAMES``; los píxeles de *mask* quedan en NaN."""
    out = {
        "ndvi":  compute_ndvi(bands["B08"], bands["B04"]),
        "bsi":   compute_bsi(bands["B11"], bands["B04"], bands["B08"], bands["B02"]),
        "ndwi":  compute_ndwi(bands["B03"], bands["B08"]),
        "mndwi": compute_mndwi(bands["B03"], bands["B11"]),
        "ndbi":  compute_ndbi(bands["B11"], bands["B08"]),
        "evi":   compute_evi(bands["B08"], bands["B04"], bands["B02"]),
        "savi":  compute_savi(bands["B08"], bands["B04"]),
    }
    if mask is not None:
        for arr in out.values():
            arr[mask] = np.nan
    return out


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------

def compute_indices(session: "SessionData") -> None:
    """Calcula todos los índices espectrales a partir de las bandas de la sesión.

    Los píxeles marcados en ``session.cloud_mask`` (SCL) quedan en NaN.

    Los resultados se almacenan en ``session.indices`` como arreglos
    ``numpy.float32``.  Los valores NaN/Inf se mantienen en los arreglos
    internos; el reemplazo por ``SENTINEL_VALUE`` sólo ocurre al serializar
    (en ``render_index_layer``).

    Requisitos: 4.1
    """
    session.indices = compute_all_indices(session.bands, session.cloud_mask)


def render_index_layer(session: "SessionData", name: str) -> bytes:
    """Genera un PNG del índice ``name`` con colormap Matplotlib y colorbar.

    * Reemplaza NaN/Inf por ``SENTINEL_VALUE`` antes de renderizar.
    * Usa los colormaps definidos en ``COLORMAPS``.
    * Incluye una barra de escala (colorbar) con el rango de valores válidos.

    Retorna los bytes del PNG.

    Requisitos: 4.2, 4.3
    """
    data: np.ndarray = session.indices[name].copy()

    # Reemplazar NaN e Inf por SENTINEL_VALUE (serialización segura)
    invalid_mask = ~np.isfinite(data)
    data[invalid_mask] = SENTINEL_VALUE

    # Calcular rango de valores válidos para la barra de escala
    valid_data = data[data != SENTINEL_VALUE]
    if valid_data.size > 0:
        # Percentiles 1–99 para que valores extremos no aplanen el contraste
        vmin = float(np.percentile(valid_data, 1))
        vmax = float(np.percentile(valid_data, 99))
    else:
        vmin, vmax = -1.0, 1.0

    # Crear máscara para píxeles con SENTINEL_VALUE (se muestran en gris)
    masked_data = np.ma.masked_where(data == SENTINEL_VALUE, data)

    cmap = plt.get_cmap(COLORMAPS[name]).copy()
    cmap.set_bad(color="lightgray")  # nubes / sin datos

    fig, ax = plt.subplots(figsize=(6, 5), tight_layout=True)
    im = ax.imshow(masked_data, cmap=cmap, vmin=vmin, vmax=vmax)
    ax.axis("off")
    ax.set_title(name.upper(), fontsize=12, fontweight="bold")

    # Barra de escala (colorbar)
    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label(f"{name.upper()} [{vmin:.3f} – {vmax:.3f}]", fontsize=9)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.read()
