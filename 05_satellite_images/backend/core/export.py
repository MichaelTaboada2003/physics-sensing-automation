# core/export.py
# Renderizado del mapa clasificado (PNG) y exportación GeoTIFF.
# Requisitos: 7.6, 8.1, 8.2

from __future__ import annotations

import io
from typing import TYPE_CHECKING

import matplotlib
matplotlib.use("Agg")  # non-interactive backend, safe for server use
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.colors import ListedColormap
import numpy as np
import rasterio
from rasterio.io import MemoryFile

from core.classes import NODATA_COLOR, scheme

if TYPE_CHECKING:
    from session_store import SessionData

# ---------------------------------------------------------------------------
# Paletas por esquema de clases (core/classes.py). Índice de colormap = código
# de clase; -1 (sin datos / nube) va al final.
# ---------------------------------------------------------------------------

def class_palette(scheme_name: str | None) -> list[str]:
    return [c.color for c in scheme(scheme_name)] + [NODATA_COLOR]


def class_legend(scheme_name: str | None) -> list[tuple[str, str]]:
    return [(c.color, c.label) for c in scheme(scheme_name)] + [(NODATA_COLOR, "Sin datos / nube")]


def _class_map_to_index(class_map: np.ndarray, n_classes: int = 3) -> np.ndarray:
    """Códigos de clase {-1, 0..n-1} → índices de colormap {0..n} (-1 → n)."""
    return np.where(class_map == -1, n_classes, class_map).astype(np.uint8)


def render_classified_map(session: "SessionData") -> bytes:
    """
    Render the session's class_map as a PNG image with a visible legend.

    Colors and legend come from the session's class scheme (core/classes.py).

    Returns:
        PNG image as bytes.

    Raises:
        ValueError: if session.class_map is None.
    """
    if session.class_map is None:
        raise ValueError(
            "La sesión no contiene un class_map. "
            "Ejecute la predicción antes de renderizar el mapa."
        )

    n = len(scheme(session.class_scheme))
    index_map = _class_map_to_index(session.class_map, n)

    fig, ax = plt.subplots(figsize=(8, 6), dpi=100)
    ax.imshow(index_map, cmap=ListedColormap(class_palette(session.class_scheme)), vmin=0, vmax=n,
              interpolation="nearest")
    ax.axis("off")

    patches = [mpatches.Patch(color=color, label=label) for color, label in class_legend(session.class_scheme)]
    ax.legend(
        handles=patches,
        loc="lower right",
        fontsize=9,
        framealpha=0.85,
        edgecolor="gray",
    )

    ax.set_title("Mapa de Clasificación", fontsize=12, pad=8)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def export_geotiff(session: "SessionData") -> bytes:
    """
    Export the session's class_map as a single-band int16 GeoTIFF.

    Uses the CRS and affine transform stored in the session (from the
    windowed read of the Sentinel-2 scene).  nodata is set to -1.

    Returns:
        GeoTIFF file contents as bytes.

    Raises:
        ValueError: if session.class_map is None.
    """
    if session.class_map is None:
        raise ValueError(
            "La sesión no contiene un class_map. "
            "Ejecute la predicción antes de exportar el GeoTIFF."
        )

    class_map = session.class_map.astype(np.int16)
    height, width = class_map.shape

    with MemoryFile() as mem_file:
        with mem_file.open(
            driver="GTiff",
            height=height,
            width=width,
            count=1,
            dtype=rasterio.int16,
            crs=session.crs,
            transform=session.transform,
            nodata=-1,
        ) as dataset:
            dataset.write(class_map, 1)

        return mem_file.read()
