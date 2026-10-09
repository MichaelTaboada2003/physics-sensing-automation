"""
routers/search.py
-----------------
Endpoint POST /search — búsqueda de escena Sentinel-2 y creación de sesión.

Requisitos cubiertos: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
"""

from __future__ import annotations

import io
import math
from datetime import date
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, field_validator

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from core.region import REGION_NAME, bbox_in_region
from core.search import list_scenes, search_scene
from core.sentinel import read_thumbnail
from session_store import SessionData, create_search, create_session, get_search

router = APIRouter()

MAX_AREA_KM2 = 500


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------

class SearchRequest(BaseModel):
    """Body del endpoint POST /search.

    Campos
    ------
    bbox : list[float]
        Bounding box ``[lon_min, lat_min, lon_max, lat_max]`` en EPSG:4326.
    time_range : str
        Rango temporal en formato ``YYYY-MM-DD/YYYY-MM-DD``.
    cloud_cover_threshold : float
        Porcentaje máximo de cobertura nubosa, rango [0, 100].
    """

    bbox: list[float]
    time_range: str
    cloud_cover_threshold: float
    # Selección manual (opcional): escena elegida de un POST /scenes previo
    search_id: Optional[str] = None
    scene_id: Optional[str] = None

    # ------------------------------------------------------------------
    # Validación de bbox (Req 2.6)
    # ------------------------------------------------------------------

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, v: list[float]) -> list[float]:
        if len(v) != 4:
            raise ValueError(
                "bbox debe contener exactamente 4 valores: "
                "[lon_min, lat_min, lon_max, lat_max]."
            )
        lon_min, lat_min, lon_max, lat_max = v

        if not (-180.0 <= lon_min <= 180.0):
            raise ValueError(
                f"lon_min={lon_min} está fuera del rango válido [-180, 180]."
            )
        if not (-180.0 <= lon_max <= 180.0):
            raise ValueError(
                f"lon_max={lon_max} está fuera del rango válido [-180, 180]."
            )
        if not (-90.0 <= lat_min <= 90.0):
            raise ValueError(
                f"lat_min={lat_min} está fuera del rango válido [-90, 90]."
            )
        if not (-90.0 <= lat_max <= 90.0):
            raise ValueError(
                f"lat_max={lat_max} está fuera del rango válido [-90, 90]."
            )
        if lon_min >= lon_max:
            raise ValueError(
                f"lon_min ({lon_min}) debe ser estrictamente menor que "
                f"lon_max ({lon_max})."
            )
        if lat_min >= lat_max:
            raise ValueError(
                f"lat_min ({lat_min}) debe ser estrictamente menor que "
                f"lat_max ({lat_max})."
            )
        # Límite de área: a 10 m, 500 km² ≈ 5 M píxeles × 16 capas en memoria
        lat_mid = math.radians((lat_min + lat_max) / 2)
        area_km2 = (lon_max - lon_min) * 111.32 * math.cos(lat_mid) * (lat_max - lat_min) * 110.57
        if area_km2 > MAX_AREA_KM2:
            raise ValueError(
                f"El área del bbox ({area_km2:.0f} km²) supera el máximo de {MAX_AREA_KM2} km². "
                "Reduzca la zona de interés."
            )
        if not bbox_in_region(v):
            raise ValueError(
                f"La zona debe estar en {REGION_NAME}: ni su centro ni sus esquinas caen dentro del territorio."
            )
        return v

    # ------------------------------------------------------------------
    # Validación de time_range (Req 2.6)
    # ------------------------------------------------------------------

    @field_validator("time_range")
    @classmethod
    def validate_time_range(cls, v: str) -> str:
        parts = v.split("/")
        if len(parts) != 2:
            raise ValueError(
                "time_range debe tener el formato 'YYYY-MM-DD/YYYY-MM-DD'."
            )
        start_str, end_str = parts
        try:
            start = date.fromisoformat(start_str)
        except ValueError:
            raise ValueError(
                f"La fecha de inicio '{start_str}' no es una fecha ISO 8601 válida "
                "(formato esperado: YYYY-MM-DD)."
            )
        try:
            end = date.fromisoformat(end_str)
        except ValueError:
            raise ValueError(
                f"La fecha de fin '{end_str}' no es una fecha ISO 8601 válida "
                "(formato esperado: YYYY-MM-DD)."
            )
        if start > end:
            raise ValueError(
                f"La fecha de inicio ({start_str}) no puede ser posterior "
                f"a la fecha de fin ({end_str})."
            )
        return v

    # ------------------------------------------------------------------
    # Validación de cloud_cover_threshold (Req 2.6)
    # ------------------------------------------------------------------

    @field_validator("cloud_cover_threshold")
    @classmethod
    def validate_cloud_cover(cls, v: float) -> float:
        if not (0.0 <= v <= 100.0):
            raise ValueError(
                f"cloud_cover_threshold={v} está fuera del rango válido [0, 100]."
            )
        return v


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/search")
async def search(request: SearchRequest) -> dict:
    """Busca la mejor escena Sentinel-2 y crea una sesión.

    Valida los parámetros de entrada (Req 2.6), consulta el catálogo STAC
    (Req 2.1), selecciona la escena con menor cobertura nubosa (Req 2.2, 2.3),
    crea una sesión con TTL de 60 minutos (Req 2.5) y devuelve los metadatos
    de la escena junto con el identificador de sesión.

    Returns
    -------
    dict
        ``{session_id, scene_id, datetime, cloud_cover}``

    Raises
    ------
    HTTPException(400)
        Si algún parámetro de entrada es inválido (Req 2.6).
    HTTPException(404)
        Si no se encontraron escenas para los parámetros dados (Req 2.4).
    HTTPException(502)
        Si la consulta al catálogo STAC falla (Req 2.7).
    """
    if request.search_id and request.scene_id:
        # Escena elegida manualmente en el selector
        search_entry = get_search(request.search_id)
        if search_entry is None or request.scene_id not in search_entry["items"]:
            raise HTTPException(
                status_code=404,
                detail="La búsqueda expiró o la escena no pertenece a ella. Busque de nuevo.",
            )
        item = search_entry["items"][request.scene_id]
        scene = {
            "id": item.id,
            "datetime": item.datetime.isoformat(),
            "cloud_cover": item.properties.get("eo:cloud_cover", 100.0),
            "item": item,
        }
    else:
        # Pydantic ya validó los campos; si llegamos aquí los datos son correctos.
        # search_scene lanza HTTPException(404) o HTTPException(502) según proceda.
        scene = search_scene(
            bbox=request.bbox,
            time_range=request.time_range,
            cloud_threshold=request.cloud_cover_threshold,
        )

    # Crear sesión con los metadatos de la escena (Req 2.5)
    # Almacenamos el item STAC firmado para que el router de descarga pueda
    # acceder a los assets sin necesidad de volver a consultar el catálogo.
    session_data = SessionData(
        scene_id=scene["id"],
        scene_datetime=scene["datetime"],
        cloud_cover=scene["cloud_cover"],
        bbox=request.bbox,
        cloud_threshold=request.cloud_cover_threshold,
        item=scene.get("item"),
    )
    session_id = create_session(session_data)

    return {
        "session_id": session_id,
        "scene_id": scene["id"],
        "datetime": scene["datetime"],
        "cloud_cover": scene["cloud_cover"],
    }


# ---------------------------------------------------------------------------
# Selector manual de escenas
# ---------------------------------------------------------------------------

@router.post("/scenes")
def scenes(request: SearchRequest) -> dict:
    """Lista hasta 12 escenas candidatas ordenadas por nubosidad dentro del bbox.

    Returns
    -------
    dict
        ``{search_id, scenes: [{id, datetime, cloud_cover, local_cloud, platform}]}``.
        ``local_cloud`` es el % de píxeles nube/sombra/nieve (SCL) en el bbox.
    """
    found = list_scenes(request.bbox, request.time_range, request.cloud_cover_threshold)
    search_id = create_search(
        request.bbox, request.cloud_cover_threshold, {s["id"]: s["item"] for s in found}
    )
    return {
        "search_id": search_id,
        "scenes": [{k: v for k, v in s.items() if k != "item"} for s in found],
    }


@router.get("/scenes/thumbnail")
def scene_thumbnail(
    search_id: str = Query(...),
    scene_id: str = Query(...),
) -> Response:
    """Miniatura en color real (asset ``visual``) recortada al bbox de la búsqueda."""
    entry = get_search(search_id)
    if entry is None or scene_id not in entry["items"]:
        raise HTTPException(status_code=404, detail="Búsqueda o escena no encontrada.")

    cached = entry["thumbnails"].get(scene_id)
    if cached is None:
        item = entry["items"][scene_id]
        try:
            rgb = read_thumbnail(item.assets["visual"].href, entry["bbox"])
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"No se pudo leer la miniatura: {exc}") from exc
        buf = io.BytesIO()
        plt.imsave(buf, np.ascontiguousarray(rgb.astype(np.uint8)), format="png")
        cached = buf.getvalue()
        entry["thumbnails"][scene_id] = cached

    return Response(content=cached, media_type="image/png",
                    headers={"Cache-Control": "max-age=1800"})
