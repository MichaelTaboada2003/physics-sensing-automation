"""
routers/heat.py
---------------
Temperatura de la superficie (Landsat 8/9) para la zona de la sesión.

  POST /heat
      Descarga la temperatura de la escena actual y, con ``year``, la de ese año
      (clasificándolo si aún no estaba).  Progress_Stream NDJSON; la línea final
      ``stage="done"`` incluye el resumen (por clase y calor vs. deforestación).

  GET /heat/summary?session_id=...[&year=...]
      Resumen con lo ya descargado.

  GET /heat/layer?session_id=...&kind=lst|delta[&year=...]
      Capa PNG RGBA alineada a la grilla de la sesión.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from core.compare import MAX_YEARS_BACK
from core.thermal import FIRST_YEAR, HEAT_LAYER_KINDS, heat_stream, heat_summary, render_heat_layer
from core.heat_series import build_heat_series, heat_series_csv, heat_series_stream
from routers.compare import _get_session_or_404, _require_class_map

router = APIRouter()


class HeatRequest(BaseModel):
    session_id: str
    year: Optional[int] = None


class HeatSeriesRequest(BaseModel):
    session_id: str
    years_back: int = Field(10, ge=1, le=MAX_YEARS_BACK)


@router.post("/heat/timeseries")
def timeseries(request: HeatSeriesRequest) -> StreamingResponse:
    session = _get_session_or_404(request.session_id)
    _require_class_map(session)
    return StreamingResponse(heat_series_stream(request.session_id, request.years_back), media_type="application/x-ndjson")


@router.get("/heat/timeseries/summary")
def timeseries_summary(session_id: str, years_back: int = Query(10, ge=1, le=MAX_YEARS_BACK)) -> dict:
    session = _get_session_or_404(session_id)
    _require_class_map(session)
    return build_heat_series(session, years_back)


@router.get("/heat/timeseries.csv")
def timeseries_csv(session_id: str, years_back: int = Query(10, ge=1, le=MAX_YEARS_BACK)) -> Response:
    session = _get_session_or_404(session_id)
    _require_class_map(session)
    series = build_heat_series(session, years_back)
    return Response(content="\ufeff" + heat_series_csv(series), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="temperatura_cobertura.csv"'})


def _check_year(session, year: Optional[int]) -> None:
    if year is None:
        return
    current = datetime.fromisoformat(session.scene_datetime).year
    low = max(FIRST_YEAR, current - MAX_YEARS_BACK)
    if not (low <= year < current):
        raise HTTPException(status_code=400, detail=f"El año debe estar entre {low} y {current - 1}.")


@router.post("/heat")
def heat(request: HeatRequest) -> StreamingResponse:
    session = _get_session_or_404(request.session_id)
    _require_class_map(session)
    _check_year(session, request.year)
    return StreamingResponse(heat_stream(request.session_id, request.year), media_type="application/x-ndjson")


def _require_heat(session, year: Optional[int]) -> None:
    current = datetime.fromisoformat(session.scene_datetime).year
    for y in (current, year):
        if y is not None and y not in session.heat:
            raise HTTPException(status_code=409, detail=f"No hay temperatura de {y}. Ejecute POST /heat primero.")


@router.get("/heat/summary")
def summary(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
    year: Optional[int] = Query(None, description="Año comparado."),
) -> dict:
    session = _get_session_or_404(session_id)
    _require_heat(session, year)
    return heat_summary(session, year)


@router.get("/heat/layer")
def layer(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
    kind: str = Query("lst", description=f"Una de {HEAT_LAYER_KINDS}."),
    year: Optional[int] = Query(None, description="Año; vacío = escena actual."),
) -> Response:
    session = _get_session_or_404(session_id)
    if kind not in HEAT_LAYER_KINDS:
        raise HTTPException(status_code=400, detail=f"Capa '{kind}' no válida. Opciones: {HEAT_LAYER_KINDS}.")
    _require_heat(session, year)
    try:
        png = render_heat_layer(session, kind, year)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(content=png, media_type="image/png")
