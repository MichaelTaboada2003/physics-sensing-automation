"""Tests del análisis temporal, capas, exportaciones, índices y métricas (STAC mockeado)."""

from __future__ import annotations

import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from affine import Affine
from fastapi.testclient import TestClient
from rasterio.crs import CRS
from sklearn.ensemble import RandomForestClassifier

from core import compare, sentinel
from core.classifier import FEATURE_NAMES, ThresholdRules, train_stream
from core.indices import INDEX_NAMES, compute_all_indices
from main import app
from session_store import SessionData, create_session

client = TestClient(app)
SHAPE = (24, 24)


# ---------------------------------------------------------------------------
# Lógica pura
# ---------------------------------------------------------------------------

def test_seasonal_time_range_handles_leap_day():
    assert compare.seasonal_time_range(datetime(2024, 2, 29), 2019, 10) == "2019-02-18/2019-03-10"


def test_boa_offset_by_baseline_and_date():
    assert sentinel.boa_offset(SimpleNamespace(properties={"s2:processing_baseline": "05.10"})) == 1000
    assert sentinel.boa_offset(SimpleNamespace(properties={"s2:processing_baseline": "02.12"})) == 0
    assert sentinel.boa_offset(SimpleNamespace(properties={}, datetime=datetime(2018, 5, 1))) == 0


def test_to_reflectance_removes_offset_and_nodata():
    dn = np.array([[0, 1000, 3000]], dtype=np.uint16)
    out = sentinel.to_reflectance(dn, 1000)
    assert np.isnan(out[0, 0]) and out[0, 1] == 0 and np.isclose(out[0, 2], 0.2)


def test_cloud_mask_from_scl():
    scl = np.array([[4, 5, 6, 8, 9, 3, 10, 0]])
    assert sentinel.cloud_mask_from_scl(scl).tolist() == [[False, False, False, True, True, True, True, True]]


def test_all_indices_and_mask():
    bands = {b: np.full((2, 2), 0.2, dtype=np.float32) for b in sentinel.BAND_SET}
    bands["B08"][:] = 0.4
    mask = np.array([[True, False], [False, False]])
    idx = compute_all_indices(bands, mask)
    assert set(idx) == set(INDEX_NAMES)
    assert np.isnan(idx["ndvi"][0, 0]) and np.isclose(idx["ndvi"][1, 1], 1 / 3)
    assert np.isclose(idx["savi"][1, 1], 1.5 * 0.2 / 1.1)


def test_change_map_and_transitions():
    past = np.array([[0, 0, 1, -1]])
    cur = np.array([[0, 2, 0, 1]])
    assert compare.change_map(past, cur).tolist() == [[0, 1, 2, 5]]
    m = compare.transition_matrix(past, cur)
    assert m[0][0] == 1 and m[0][2] == 1 and m[1][0] == 1 and m[3][1] == 1


def test_trend_test_theil_sen_mann_kendall():
    years = list(range(2016, 2026))
    # Tendencia clara con un año atípico: Theil-Sen no se deja arrastrar por él
    ys = [10 + 2 * i for i in range(10)]
    ys[5] = 80
    t = compare.trend_test(years, ys)
    assert t["slope"] == 2.0 and t["significant"] and t["p_value"] < 0.001
    assert t["slope_low"] <= 2.0 <= t["slope_high"]
    # Serie sin tendencia → no significativa
    flat = compare.trend_test(years, [5, 7, 4, 6, 5, 7, 4, 6, 5, 6])
    assert not flat["significant"]
    # Constante y pocos años
    assert compare.trend_test(years, [3.0] * 10)["p_value"] == 1.0
    assert compare.trend_test([2020, 2021, 2022], [1, 2, 3]) is None


def test_pseudo_labels_discard_ambiguous_pixels():
    from core.classifier import pseudo_labels
    rules = ThresholdRules()
    #        vegetación    agua           agua∧minería (río turbio)   nada
    ndvi = np.array([0.8, 0.0, 0.0, 0.4])
    bsi = np.array([-0.3, -0.2, 0.2, 0.0])
    ndwi = np.array([-0.5, 0.3, 0.3, 0.0])
    labels, ambiguous = pseudo_labels(ndvi, bsi, ndwi, rules)
    assert labels.tolist() == [0, 1, -1, -1]
    assert ambiguous.tolist() == [False, False, True, False]


def test_proportional_subsample_keeps_class_shares():
    from core.classifier import _proportional_subsample
    y = np.array([0] * 90_000 + [1] * 2_000 + [2] * 8_000)
    keep = _proportional_subsample(y, 10_000, 1_000, np.random.default_rng(0))
    counts = np.bincount(y[keep])
    assert counts[0] == 9_000 and counts[2] == 1_000   # 90 % y 8 % → proporcional (8 % = 800 → mínimo 1000)
    assert counts[1] == 1_000                           # clase rara: mínimo garantizado
    assert _proportional_subsample(y[:500], 10_000, 1_000, np.random.default_rng(0)).size == 500


# ---------------------------------------------------------------------------
# Fixtures sintéticas
# ---------------------------------------------------------------------------

def _make_session() -> tuple[str, SessionData]:
    rng = np.random.default_rng(0)
    bands = {b: rng.uniform(0.02, 0.4, SHAPE).astype(np.float32) for b in sentinel.BAND_SET}
    s = SessionData(
        scene_id="CUR", scene_datetime="2026-07-15T15:00:00+00:00", cloud_cover=3.0,
        bbox=[-74.85, 7.55, -74.80, 7.60], cloud_threshold=20.0,
        item=SimpleNamespace(properties={"s2:processing_baseline": "05.11"}),
        crs=CRS.from_epsg(32618), transform=Affine(10, 0, 590000, 0, -10, 840000), bands=bands,
        cloud_mask=np.zeros(SHAPE, dtype=bool),
    )
    X = rng.uniform(0, 1, (60, len(FEATURE_NAMES)))
    s.classifier = RandomForestClassifier(n_estimators=3, random_state=0).fit(X, np.arange(60) % 3)
    s.class_map = rng.integers(0, 3, SHAPE).astype(np.int16)
    s.class_map[0, 0] = -1
    return create_session(s), s


def _past_scene(year: int):
    item = SimpleNamespace(
        properties={"s2:processing_baseline": "02.09"},
        assets={a: SimpleNamespace(href=a) for a in [*sentinel.BAND_SET, sentinel.SCL_ASSET]},
    )
    return {"id": f"PAST{year}", "datetime": f"{year}-07-10T15:00:00+00:00", "cloud_cover": 5.0,
            "local_cloud": 1.0, "item": item}


def _fake_read(href, crs, transform, shape, resampling=None):
    if href == sentinel.SCL_ASSET:
        scl = np.full(shape, 4, dtype=np.uint8)
        scl[:4, :] = 9  # franja de nubes
        return scl
    return np.full(shape, 1500, dtype=np.uint16)


def _lines(resp):
    return [json.loads(l) for l in resp.text.splitlines() if l.strip()]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def test_compare_endpoint_end_to_end():
    sid, session = _make_session()
    with patch.object(compare, "best_scene", side_effect=lambda b, tr, c: _past_scene(2018)), \
         patch.object(compare, "read_on_grid", side_effect=_fake_read):
        lines = _lines(client.post("/compare", json={"session_id": sid, "year": 2018}))
    assert lines[-1]["stage"] == "done", lines[-1]
    summary = lines[-1]["comparison"]
    assert summary["year"] == 2018 and summary["past_scene"]["id"] == "PAST2018"

    entry = session.comparisons[2018]
    # Baseline antiguo (offset 0): 1500 DN → 0.15 de reflectancia
    assert np.allclose(entry["rgb"]["B04"], 0.15)
    # La franja con nubes (SCL=9) queda sin clasificar
    assert (entry["class_map"][:4] == -1).all() and (entry["class_map"][4:] >= 0).all()

    assert client.get("/compare/image", params={"session_id": sid, "year": 2018}).headers["content-type"] == "image/png"
    assert client.get("/compare/summary", params={"session_id": sid, "year": 2018}).json()["year"] == 2018


def test_compare_reports_missing_year():
    from fastapi import HTTPException
    sid, _ = _make_session()

    def _none(*_a):
        raise HTTPException(status_code=404, detail="nada")

    with patch.object(compare, "best_scene", side_effect=_none):
        lines = _lines(client.post("/compare", json={"session_id": sid, "year": 2017}))
    assert lines[-1]["stage"] == "error" and "2017" in lines[-1]["error"]


def test_compare_rejects_out_of_range_year():
    sid, _ = _make_session()
    assert client.post("/compare", json={"session_id": sid, "year": 2015}).status_code == 400
    assert client.post("/compare", json={"session_id": sid, "year": 2026}).status_code == 400


def test_timeseries_layers_and_exports():
    sid, session = _make_session()

    def _scene(bbox, tr, cloud):
        year = int(tr[:4])
        if year == 2024:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="sin escenas")
        return _past_scene(year)

    with patch.object(compare, "best_scene", side_effect=_scene), \
         patch.object(compare, "read_on_grid", side_effect=_fake_read):
        lines = _lines(client.post("/timeseries", json={"session_id": sid, "years_back": 4}))
    done = lines[-1]
    assert done["stage"] == "done", done
    series = done["series"]
    assert [p["year"] for p in series["points"]] == [2022, 2023, 2025, 2026]
    assert [f["year"] for f in series["failed"]] == [2024]
    assert set(series["trends"]) == {"vegetation", "water", "mining"}

    for kind in ("rgb", "class", "ndvi"):
        r = client.get("/layer", params={"session_id": sid, "kind": kind})
        assert r.status_code == 200 and r.content[:4] == b"\x89PNG"
    year = series["points"][0]["year"]
    assert client.get("/layer", params={"session_id": sid, "kind": "change", "year": year}).status_code == 200
    assert client.get("/layer", params={"session_id": sid, "kind": "change"}).status_code == 400
    b = client.get("/layer/bounds", params={"session_id": sid}).json()["bounds"]
    assert b[0][0] < b[1][0] and b[0][1] < b[1][1]

    csv_text = client.get("/export/stats.csv", params={"session_id": sid}).text
    assert csv_text.startswith("year,scene_id") and "vegetation" in csv_text

    gj = client.get("/export/changes.geojson",
                    params={"session_id": sid, "year": year, "min_area_ha": 0}).json()
    assert gj["type"] == "FeatureCollection" and gj["features"]
    lon, lat = gj["features"][0]["geometry"]["coordinates"][0][0]
    assert -76 < lon < -73 and 6 < lat < 9

    report = client.get("/export/report.html", params={"session_id": sid})
    assert report.status_code == 200 and "Evolución temporal" in report.text

    for kind in ("rgb", "class"):
        ba = client.get("/export/beforeafter.png", params={"session_id": sid, "year": year, "kind": kind, "title": "El Bagre"})
        assert ba.status_code == 200 and ba.content[:4] == b"\x89PNG"
    assert client.get("/export/beforeafter.png", params={"session_id": sid, "year": 1999}).status_code == 409
    tr = client.get("/export/trend.png", params={"session_id": sid, "title": "El Bagre"})
    assert tr.status_code == 200 and tr.content[:4] == b"\x89PNG"


def test_train_reports_holdout_metrics():
    sid, session = _make_session()
    session.class_map = None
    session.classifier = None
    rules = ThresholdRules(ndvi_veg_min=0.3, bsi_veg_max=0.0, ndwi_water_min=0.2, ndvi_water_max=0.1,
                           bsi_mining_min=0.0, ndvi_mining_max=0.25)
    rng = np.random.default_rng(1)
    # Tres "materiales" sintéticos que cumplen cada regla
    for b in session.bands:
        session.bands[b][:] = 0.1
    session.bands["B08"][:8] = 0.5             # vegetación
    session.bands["B03"][8:16] = 0.3           # agua (NDWI alto, NDVI bajo)
    session.bands["B08"][8:16] = 0.05
    session.bands["B11"][8:16] = 0.02          # SWIR bajo → BSI < 0 (no pasa por suelo)
    session.bands["B11"][16:] = 0.4            # suelo (BSI alto)
    for b in session.bands:
        session.bands[b] += rng.normal(0, 0.003, SHAPE).astype(np.float32)
    session.indices = {}

    lines = [json.loads(l) for l in train_stream(sid, rules)]
    done = lines[-1]
    assert done["stage"] == "done", done
    m = done["metrics"]
    assert m["accuracy"] > 0.9 and len(m["confusion_matrix"]) == 3
    assert len(m["feature_importances"]) == len(FEATURE_NAMES)


def test_scenes_endpoint_and_manual_selection():
    item = SimpleNamespace(id="S2X", datetime=datetime(2025, 7, 1), properties={"eo:cloud_cover": 12.0},
                           assets={})
    found = [{"id": "S2X", "datetime": "2025-07-01T00:00:00", "cloud_cover": 12.0, "local_cloud": 3.5,
              "platform": "sentinel-2a", "item": item}]
    payload = {"bbox": [-74.85, 7.55, -74.80, 7.60], "time_range": "2025-01-01/2025-12-31",
               "cloud_cover_threshold": 60}
    with patch("routers.search.list_scenes", return_value=found):
        r = client.post("/scenes", json=payload).json()
    assert r["scenes"][0]["local_cloud"] == 3.5 and "item" not in r["scenes"][0]

    sel = client.post("/search", json={**payload, "search_id": r["search_id"], "scene_id": "S2X"}).json()
    assert sel["scene_id"] == "S2X" and sel["session_id"]
    bad = client.post("/search", json={**payload, "search_id": r["search_id"], "scene_id": "NOPE"})
    assert bad.status_code == 404


def test_search_rejects_oversized_bbox():
    payload = {"bbox": [-75.0, 7.0, -74.0, 8.0], "time_range": "2025-01-01/2025-12-31",
               "cloud_cover_threshold": 60}
    r = client.post("/scenes", json=payload)
    assert r.status_code in (400, 422) and "km²" in r.text


def test_region_limits_search_to_colombia():
    from core.region import bbox_in_region, contains
    assert contains(-74.08, 4.65)                       # Bogotá
    assert contains(-81.70, 12.55)                      # San Andrés
    assert not contains(-66.90, 10.50)                  # Caracas
    assert bbox_in_region([-70.0, -4.25, -69.9, -4.15])  # Leticia (zona en la frontera)

    base = {"time_range": "2025-01-01/2025-12-31", "cloud_cover_threshold": 60}
    r = client.post("/scenes", json={**base, "bbox": [-66.95, 10.45, -66.85, 10.55]})  # Caracas
    assert r.status_code in (400, 422) and "Colombia" in r.text

    reg = client.get("/region").json()
    assert reg["name"] == "Colombia" and reg["geojson"]["features"][0]["geometry"]["type"] == "MultiPolygon"


def test_map_stats_for_label():
    sid, session = _make_session()
    d = client.get("/map/stats", params={"session_id": sid}).json()
    assert d["scene_id"] == "CUR" and d["cloud_fraction"] == 0.0
    assert set(d["classes"]) == {"vegetation", "water", "mining", "unclassified"}
    session.class_map = None
    assert client.get("/map/stats", params={"session_id": sid}).json()["classes"] is None
