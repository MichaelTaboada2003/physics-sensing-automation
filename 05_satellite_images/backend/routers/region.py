"""
routers/region.py
-----------------
GET /region — contorno (GeoJSON) y límites de la región de trabajo (Colombia).
"""

from __future__ import annotations

from fastapi import APIRouter

from core.region import REGION_NAME, region_bounds, region_geojson

router = APIRouter()


@router.get("/region")
def region() -> dict:
    return {"name": REGION_NAME, "bounds": region_bounds(), "geojson": region_geojson()}
