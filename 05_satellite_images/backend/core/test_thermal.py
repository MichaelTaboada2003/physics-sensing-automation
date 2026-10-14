"""Tests de temperatura de superficie (Landsat mockeado)."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from core import compare, thermal
from core.test_compare import _fake_read, _lines, _make_session, _past_scene, client


def test_qa_and_celsius_conversion():
    qa = np.array([[21824, 1, 0b1000, 0b10000, 21762]], dtype=np.uint16)
    assert thermal.qa_invalid(qa).tolist() == [[False, True, True, True, True]]
    # 300 K → 26.85 °C
    dn = np.array([[0, round((300 - 149) / thermal.ST_SCALE), 44000]], dtype=np.uint16)
    out = thermal.st_to_celsius(dn, np.array([[False, False, True]]))
    assert np.isnan(out[0, 0]) and abs(out[0, 1] - 26.85) < 0.01 and np.isnan(out[0, 2])


def test_trend_surface_removes_gradient():
    yy, xx = np.mgrid[0:40, 0:40]
    values = (2 + 0.1 * xx - 0.05 * yy).astype(np.float32)
    surf = thermal.trend_surface(values, np.ones(values.shape, bool))
    assert np.allclose(surf, values, atol=1e-3)


def test_deforestation_heat_recovers_planted_warming_despite_gradient():
    rng = np.random.default_rng(1)
    shape = (120, 120)
    yy, xx = np.mgrid[0:120, 0:120]
    past = np.zeros(shape, np.int16)       # todo era bosque
    cur = np.zeros(shape, np.int16)
    lost = (rng.uniform(size=(12, 12)) < 0.3).repeat(10, 0).repeat(10, 1)
    cur[lost] = 4                           # pasó a pastos
    lst_past = 30 + rng.normal(0, 0.5, shape)
    gradient = 0.03 * yy                    # la atmósfera de la escena nueva cambia de sur a norte
    lst_now = lst_past + 1.0 + gradient + 2.0 * lost + rng.normal(0, 0.5, shape)
    out = thermal.deforestation_heat(lst_now, lst_past, past, cur, block_px=10, area_m2=100)
    assert out["enough"] and out["significant"]
    assert abs(out["did"] - 2.0) < 0.3 and out["did_low"] < out["did"] < out["did_high"]
    assert out["lost_now_mean"] > out["kept_now_mean"]

    tiny = np.zeros(shape, bool)
    tiny[:3, :3] = True
    cur2 = np.where(tiny, 4, 0).astype(np.int16)
    assert thermal.deforestation_heat(lst_now, lst_past, past, cur2, 10, 100)["enough"] is False


def _landsat(year: int):
    item = SimpleNamespace(
        id=f"LC08_{year}", datetime=datetime(year, 7, 1, 15, tzinfo=timezone.utc),
        properties={"platform": "landsat-8", "eo:cloud_cover": 10.0},
        assets={"lwir11": SimpleNamespace(href=f"st{year}"), "qa_pixel": SimpleNamespace(href="qa")},
    )
    return {"item": item, "local_clear": 0.97}


def _fake_landsat_read(href, crs, transform, shape, resampling=None):
    if href == "qa":
        qa = np.full(shape, 21824, dtype=np.uint16)
        qa[:2, :] = 0b1000 | 21824          # franja de nubes
        return qa
    base = 30.0 if href.endswith("2018") else 32.0
    return np.full(shape, round((base + thermal.KELVIN - 149) / thermal.ST_SCALE), dtype=np.uint16)


def test_heat_endpoints_end_to_end():
    sid, session = _make_session()
    with patch.object(thermal, "best_landsat_scene", side_effect=lambda b, dt, y, r: _landsat(y)), \
         patch.object(thermal, "read_on_grid", side_effect=_fake_landsat_read), \
         patch.object(compare, "best_scene", side_effect=lambda b, tr, c: _past_scene(2018)), \
         patch.object(compare, "read_on_grid", side_effect=_fake_read):
        lines = _lines(client.post("/heat", json={"session_id": sid, "year": 2018}))
    done = lines[-1]
    assert done["stage"] == "done", done
    heat = done["heat"]
    assert heat["year"] == 2026 and heat["past"]["year"] == 2018
    assert 2018 in session.comparisons                  # clasificó el año que faltaba
    assert abs(heat["overall"]["mean"] - 32.0) < 0.05 and heat["clear_percent"] < 100
    assert {c["key"] for c in heat["by_class"]} <= {"vegetation", "water", "mining"}
    assert heat["deforestation"] is not None and len(heat["ramp"]) == 7

    for kind, year in (("lst", None), ("lst", 2018), ("delta", 2018)):
        params = {"session_id": sid, "kind": kind} | ({"year": year} if year else {})
        r = client.get("/heat/layer", params=params)
        assert r.status_code == 200 and r.content[:4] == b"\x89PNG"
    assert client.get("/heat/layer", params={"session_id": sid, "kind": "delta"}).status_code == 400
    assert client.get("/heat/layer", params={"session_id": sid, "year": 2019}).status_code == 409
    assert client.get("/heat/summary", params={"session_id": sid, "year": 2018}).json()["past"]["year"] == 2018
    assert client.post("/heat", json={"session_id": sid, "year": 2012}).status_code == 400


def test_heat_reports_missing_landsat():
    sid, _ = _make_session()

    def _none(*_a):
        raise thermal.ThermalError("2026: no hay escenas Landsat")

    with patch.object(thermal, "best_landsat_scene", side_effect=_none):
        lines = _lines(client.post("/heat", json={"session_id": sid}))
    assert lines[-1]["stage"] == "error" and "Landsat" in lines[-1]["error"]
