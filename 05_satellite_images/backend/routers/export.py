"""
routers/export.py
-----------------
Endpoints para visualización y descarga del mapa clasificado.

  GET /map/classified?session_id=...
      Devuelve el mapa clasificado como imagen PNG con leyenda.

  GET /download/classified.png?session_id=...
      Descarga el mapa clasificado como PNG con Content-Disposition attachment.

  GET /download/classified.tif?session_id=...
      Descarga el mapa clasificado como GeoTIFF con Content-Disposition attachment.

Requisitos cubiertos: 7.3, 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from core.compare import class_stats, pixel_area_m2
from core.export import export_geotiff, render_classified_map
from core.report import changes_geojson, render_before_after, render_trend_chart, report_html, stats_csv
from session_store import get_session

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_session_or_404(session_id: str):
    """Retrieve a session or raise HTTP 404 if not found / expired.

    Parameters
    ----------
    session_id : str
        The session identifier from the query parameter.

    Returns
    -------
    SessionData
        The active session.

    Raises
    ------
    HTTPException(404)
        If the session does not exist or has expired (Req 7.3, 8.4).
    """
    if not session_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "El parámetro 'session_id' es obligatorio. "
                "Proporcione un identificador de sesión válido."
            ),
        )
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


def _require_class_map(session, session_id: str) -> None:
    """Raise HTTP 409 if the session has no class_map.

    Parameters
    ----------
    session : SessionData
        The active session.
    session_id : str
        Used only for the error message.

    Raises
    ------
    HTTPException(409)
        If ``session.class_map`` is None (Req 7.7, 8.3).
    """
    if session.class_map is None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"La sesión '{session_id}' no contiene un mapa clasificado. "
                "Ejecute POST /predict para generar el Class_Map antes de "
                "solicitar el mapa o la descarga."
            ),
        )


# ---------------------------------------------------------------------------
# GET /map/classified
# ---------------------------------------------------------------------------

@router.get("/map/classified")
def get_classified_map(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
) -> Response:
    """Devuelve el mapa clasificado como imagen PNG con leyenda.

    Renderiza el ``class_map`` de la sesión usando el colormap
    ``ListedColormap(['green', 'blue', 'saddlebrown', 'black'])`` y una
    leyenda visible con las cuatro clases.

    Parameters
    ----------
    session_id : str
        Identificador de la sesión (query param).

    Returns
    -------
    Response
        Imagen PNG con ``media_type="image/png"``.

    Raises
    ------
    HTTPException(404)
        Si la sesión no existe o ha expirado (Req 7.3).
    HTTPException(409)
        Si la predicción no ha finalizado o nunca se ejecutó (Req 7.7).
    """
    session = _get_session_or_404(session_id)
    _require_class_map(session, session_id)

    try:
        png_bytes = render_classified_map(session)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Error al renderizar el mapa clasificado: {exc}",
        ) from exc

    return Response(content=png_bytes, media_type="image/png")


# ---------------------------------------------------------------------------
# GET /download/classified.png
# ---------------------------------------------------------------------------

@router.get("/download/classified.png")
def download_classified_png(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
) -> Response:
    """Descarga el mapa clasificado como PNG con cabecera Content-Disposition.

    Devuelve el mismo PNG que ``GET /map/classified`` pero con la cabecera
    ``Content-Disposition: attachment; filename="mapa_clasificacion.png"``
    para forzar la descarga en el navegador.

    Parameters
    ----------
    session_id : str
        Identificador de la sesión (query param).

    Returns
    -------
    Response
        Imagen PNG con ``media_type="image/png"`` y cabecera de descarga.

    Raises
    ------
    HTTPException(404)
        Si la sesión no existe o ha expirado (Req 8.4).
    HTTPException(409)
        Si la sesión no contiene un Class_Map (Req 8.3).
    HTTPException(500)
        Si la generación del PNG falla durante la exportación (Req 8.5).
    """
    session = _get_session_or_404(session_id)
    _require_class_map(session, session_id)

    try:
        png_bytes = render_classified_map(session)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Error al generar el PNG de descarga: {exc}",
        ) from exc

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "Content-Disposition": 'attachment; filename="mapa_clasificacion.png"',
        },
    )


# ---------------------------------------------------------------------------
# GET /download/classified.tif
# ---------------------------------------------------------------------------

@router.get("/download/classified.tif")
def download_classified_tif(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
) -> Response:
    """Descarga el mapa clasificado como GeoTIFF con cabecera Content-Disposition.

    Genera un GeoTIFF de una sola banda ``int16`` con el CRS y la
    transformación afín de la ventana leída de Sentinel-2, con ``nodata=-1``.

    Parameters
    ----------
    session_id : str
        Identificador de la sesión (query param).

    Returns
    -------
    Response
        Archivo GeoTIFF con ``media_type="image/tiff"`` y cabecera de descarga.

    Raises
    ------
    HTTPException(404)
        Si la sesión no existe o ha expirado (Req 8.4).
    HTTPException(409)
        Si la sesión no contiene un Class_Map (Req 8.3).
    HTTPException(500)
        Si la generación del GeoTIFF falla durante la exportación (Req 8.5).
    """
    session = _get_session_or_404(session_id)
    _require_class_map(session, session_id)

    try:
        tif_bytes = export_geotiff(session)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Error al generar el GeoTIFF de descarga: {exc}",
        ) from exc

    return Response(
        content=tif_bytes,
        media_type="image/tiff",
        headers={
            "Content-Disposition": 'attachment; filename="mapa_clasificacion.tif"',
        },
    )


# ---------------------------------------------------------------------------
# Reporte y exportaciones del análisis
# ---------------------------------------------------------------------------

@router.get("/export/report.html")
def export_report(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
) -> Response:
    """Reporte HTML autocontenido (imágenes embebidas), imprimible a PDF."""
    session = _get_session_or_404(session_id)
    _require_class_map(session, session_id)
    try:
        content = report_html(session)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Error al generar el reporte: {exc}") from exc
    return Response(
        content=content,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": 'inline; filename="reporte_cobertura.html"'},
    )


@router.get("/export/stats.csv")
def export_stats_csv(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
) -> Response:
    """Superficie por clase y año (escena actual + años comparados)."""
    session = _get_session_or_404(session_id)
    _require_class_map(session, session_id)
    return Response(
        content=stats_csv(session),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="superficie_por_clase.csv"'},
    )


@router.get("/export/changes.geojson")
def export_changes_geojson(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
    year: int = Query(..., description="Año comparado."),
    min_area_ha: float = Query(0.5, ge=0, le=100, description="Área mínima por polígono (ha)."),
) -> Response:
    """Polígonos de cambio entre *year* y la escena actual (EPSG:4326)."""
    session = _get_session_or_404(session_id)
    _require_class_map(session, session_id)
    if year not in session.comparisons:
        raise HTTPException(status_code=409, detail=f"No hay comparativa para {year}. Ejecute POST /compare.")
    data = changes_geojson(session, year, min_area_ha)
    return Response(
        content=json.dumps(data, ensure_ascii=False),
        media_type="application/geo+json",
        headers={"Content-Disposition": f'attachment; filename="cambios_{year}.geojson"'},
    )


# ---------------------------------------------------------------------------
# GET /map/stats — datos de la etiqueta del ejemplar
# ---------------------------------------------------------------------------

@router.get("/map/stats")
def map_stats(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
) -> dict:
    """Nubosidad en la zona y, si ya hay mapa, superficie por clase.

    Alimenta la etiqueta del ejemplar en el frontend; responde también antes de
    clasificar (``classes`` = null) para mostrar la escena y sus nubes.
    """
    session = _get_session_or_404(session_id)
    has_bands = bool(session.bands)
    return {
        "scene_id": session.scene_id,
        "datetime": session.scene_datetime,
        "cloud_fraction": round(session.cloud_fraction, 4) if has_bands else None,
        "pixel_area_m2": pixel_area_m2(session) if has_bands else None,
        "classes": (
            class_stats(session.class_map, pixel_area_m2(session))
            if session.class_map is not None else None
        ),
    }


# ---------------------------------------------------------------------------
# Imágenes para publicar
# ---------------------------------------------------------------------------

def _clean_title(title: str) -> str:
    """Título libre para la imagen: una línea, sin caracteres de control."""
    return " ".join(title.split())[:120]


@router.get("/export/beforeafter.png")
def export_before_after(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
    year: int = Query(..., description="Año comparado."),
    kind: str = Query("rgb", pattern="^(rgb|class)$", description="rgb = color real, class = clasificación."),
    title: str = Query("", max_length=200, description="Título opcional (p. ej. el nombre de la zona)."),
) -> Response:
    """Antes/después lado a lado con fechas, escala y crédito de Copernicus."""
    session = _get_session_or_404(session_id)
    _require_class_map(session, session_id)
    if year not in session.comparisons:
        raise HTTPException(status_code=409, detail=f"No hay comparativa para {year}. Ejecute POST /compare.")
    png = render_before_after(session, year, kind, _clean_title(title))
    return Response(content=png, media_type="image/png",
                    headers={"Content-Disposition": f'attachment; filename="antes_despues_{year}_{kind}.png"'})


@router.get("/export/trend.png")
def export_trend(
    session_id: str = Query(..., description="Identificador de la sesión activa."),
    title: str = Query("", max_length=200, description="Título opcional."),
) -> Response:
    """Gráfico de la serie de vegetación con su tendencia, significancia y crédito."""
    session = _get_session_or_404(session_id)
    _require_class_map(session, session_id)
    if len(session.comparisons) < 3:
        raise HTTPException(status_code=409, detail="Calcule la serie temporal (al menos 3 años) antes de exportar el gráfico.")
    png = render_trend_chart(session, _clean_title(title))
    return Response(content=png, media_type="image/png",
                    headers={"Content-Disposition": 'attachment; filename="tendencia_vegetacion.png"'})
