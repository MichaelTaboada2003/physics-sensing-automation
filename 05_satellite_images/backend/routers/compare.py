"""
routers/compare.py
------------------
Endpoints de la comparativa temporal (hasta 10 años atrás).

  POST /compare
      Busca, descarga y clasifica la escena del año indicado con el modelo
      de la sesión.  Devuelve un Progress_Stream NDJSON cuya línea final
      ``stage="done"`` incluye el resumen estadístico.

  GET /compare/image?session_id=...&year=...
      Figura PNG comparativa (color real, ΔNDVI, clasificaciones y cambios).

  GET /compare/summary?session_id=...&year=...
      Resumen estadístico de una comparativa ya calculada.

  POST /timeseries
      Procesa hasta 10 años anteriores en paralelo (Progress_Stream NDJSON);
      la línea final incluye la serie y las tendencias lineales por clase.

  GET /layer?session_id=...&kind=rgb|class|ndvi|change[&year=...]
      Capa PNG RGBA sin ejes, alineada a la grilla, para superponer en el mapa.

  GET /layer/bounds?session_id=...
      Límites geográficos (EPSG:4326) de la grilla de la sesión.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from core.compare import (
    LAYER_KINDS,
    MAX_YEARS_BACK,
    build_summary,
    compare_stream,
    render_comparison,
    render_layer,
    timeseries_stream,
)
from core.sentinel import grid_bounds_latlon
from session_store import get_session

router = APIRouter()


class CompareRequest(BaseModel):
    """Body del endpoint POST /compare."""

    session_id: str
    year: int


class TimeseriesRequest(BaseModel):
    """Body del endpoint POST /timeseries."""

    session_id: str
    years_back: int = MAX_YEARS_BACK


def _require_class_map(session) -> None:
    if session.classifier is None or session.class_map is None:
        raise HTTPException(
            status_code=409,
            detail="Entrene el clasificador y genere el mapa actual antes de comparar.",
        )


def _get_session_or_404(session_id: str):
    session = get_session(session_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Sesión '{session_id}' no encontrada o expirada. "
                "Realice una nueva búsqueda para obtener un identificador de sesión válido."
            ),
        )
    return session


def _get_comparison_or_409(session, session_id: str, year: int):
    if year not in session.comparisons or session.class_map is None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"La sesión '{session_id}' no tiene una comparativa para {year}. "
                "Ejecute POST /compare primero."
            ),
        )


@router.post("/compare")
def compare(request: CompareRequest) -> StreamingResponse:
    session = _get_session_or_404(request.session_id)
    _require_class_map(session)

    current_year = datetime.fromisoformat(session.scene_datetime).year
    min_year = current_year - MAX_YEARS_BACK
    if not (min_year <= request.year < current_year):
        raise HTTPException(
            status_code=400,
            detail=f"El año debe estar entre {min_year} y {current_year - 1}.",
        )

    return StreamingResponse(
        compare_stream(request.session_id, request.year),
        media_type="application/x-ndjson",
    )


@router.get("/compare/image")
def compare_image(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
    year: int = Query(..., description="Año comparado."),
) -> Response:
    session = _get_session_or_404(session_id)
    _get_comparison_or_409(session, session_id, year)
    try:
        png = render_comparison(session, year)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Error al renderizar la comparativa: {exc}") from exc
    return Response(content=png, media_type="image/png")


@router.get("/compare/summary")
def compare_summary(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
    year: int = Query(..., description="Año comparado."),
) -> dict:
    session = _get_session_or_404(session_id)
    _get_comparison_or_409(session, session_id, year)
    return build_summary(session, year)


@router.post("/timeseries")
def timeseries(request: TimeseriesRequest) -> StreamingResponse:
    session = _get_session_or_404(request.session_id)
    _require_class_map(session)
    if not (1 <= request.years_back <= MAX_YEARS_BACK):
        raise HTTPException(status_code=400, detail=f"years_back debe estar entre 1 y {MAX_YEARS_BACK}.")
    return StreamingResponse(
        timeseries_stream(request.session_id, request.years_back),
        media_type="application/x-ndjson",
    )


@router.get("/layer")
def layer(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
    kind: str = Query(..., description=f"Una de {LAYER_KINDS}."),
    year: Optional[int] = Query(None, description="Año comparado; vacío = escena actual."),
) -> Response:
    session = _get_session_or_404(session_id)
    if kind not in LAYER_KINDS:
        raise HTTPException(status_code=400, detail=f"Capa '{kind}' no válida. Opciones: {LAYER_KINDS}.")
    if kind in ("class", "change") and session.class_map is None:
        raise HTTPException(status_code=409, detail="La sesión aún no tiene mapa clasificado.")
    if not session.bands:
        raise HTTPException(status_code=409, detail="Descargue las bandas primero.")
    if year is not None:
        _get_comparison_or_409(session, session_id, year)
    try:
        png = render_layer(session, kind, year)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(content=png, media_type="image/png")


@router.get("/layer/bounds")
def layer_bounds(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
) -> dict:
    session = _get_session_or_404(session_id)
    if session.transform is None or not session.bands:
        raise HTTPException(status_code=409, detail="Descargue las bandas primero.")
    shape = session.bands["B04"].shape
    return {"bounds": grid_bounds_latlon(session.crs, session.transform, shape), "bbox": session.bbox}
