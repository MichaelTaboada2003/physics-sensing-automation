"""La comparación nueva mide diferencias observadas, no diferencias de diferencias."""
import csv
import io
import json
from unittest.mock import patch

import numpy as np

from core import heat_series
from core.classifier import predict_stream, train_stream
from core.test_compare import _make_session, client


def _prepared():
    sid, s = _make_session()
    base = np.ones(s.class_map.shape, dtype=np.int16)
    base[:, :12] = 0
    s.class_map = base.copy()
    s.class_map[:, :2] = 2
    s.classifier_id = "model-1"
    s.comparisons[2025] = {"classifier_id": "model-1", "class_map": base,
                           "scene": {"id": "C2025", "datetime": "2025-07-01T15:00:00Z"}}
    for y, temp in [(2025, 30.), (2026, 32.)]:
        s.heat[y] = {"lst": np.full(base.shape, temp, dtype=np.float32), "scene": {
            "id": f"L{y}", "datetime": f"{y}-07-12T15:00:00Z", "platform": "landsat-8",
            "cloud_cover": 0., "local_clear": 100.}, "clear_percent": 100.}
    return sid, s


def test_observed_change_is_not_detrended_and_uses_identical_pixels():
    _, s = _prepared()
    s.heat[2025]["lst"][0] = np.nan
    s.heat[2026]["lst"][-1] = np.nan
    # Sesgo grande fuera del soporte común: no puede cambiar las medias.
    s.heat[2026]["lst"][0] = 70
    s.heat[2025]["lst"][-1] = 5
    result = heat_series.build_heat_series(s, 1)
    assert result["enough"] and result["reference_year"] == 2025
    assert result["common_hectares"] == 5.28
    base, now = result["points"]
    assert base["temperature_mean"] == 30 and now["temperature_mean"] == 32
    assert now["temperature_change"] == 2  # un calentamiento general NO se descuenta
    assert base["loss_hectares"] == 0 and now["loss_hectares"] == .44
    assert base["cover_hectares"] == 2.64 and now["cover_hectares"] == 2.2


def test_disjoint_cloud_masks_do_not_create_a_false_comparison():
    _, s = _prepared()
    s.heat[2025]["lst"][:12] = np.nan
    s.heat[2026]["lst"][12:] = np.nan
    r = heat_series.build_heat_series(s, 1)
    assert not r["enough"] and r["common_percent"] == 0
    assert all(p["temperature_change"] is None and p["loss_hectares"] is None for p in r["points"])


def test_missing_year_is_null_not_zero_and_does_not_remove_valid_years():
    _, s = _prepared()
    r = heat_series.build_heat_series(s, 2)
    assert r["enough"] and r["reference_year"] == 2025
    assert r["points"][0]["year"] == 2024
    assert r["points"][0]["temperature_mean"] is None and r["points"][0]["reason"]
    assert r["points"][-1]["temperature_change"] == 2


def test_primary_not_learned_does_not_report_zero_cover():
    _, s = _prepared()
    s.classifier.classes_ = np.array([1, 2])
    r = heat_series.build_heat_series(s, 1)
    assert r["enough"] and not r["primary_learned"]
    assert all(p["cover_hectares"] is None and p["loss_hectares"] is None for p in r["points"])
    assert r["points"][-1]["temperature_mean"] == 32


def test_unknown_or_old_model_comparison_is_not_reused():
    _, s = _prepared()
    for entry in ({}, {"classifier_id": "old"}):
        s.comparisons[2025] = entry
        r = heat_series.build_heat_series(s, 1)
        assert not r["enough"]
        assert "compatible" in r["points"][0]["reason"]


def test_repeated_landsat_scene_is_not_counted_as_two_years():
    _, s = _prepared()
    s.heat[2026]["scene"] = s.heat[2025]["scene"]
    r = heat_series.build_heat_series(s, 1)
    assert not r["enough"]
    assert "repetida" in r["points"][-1]["reason"]
    assert r["points"][-1]["temperature_change"] is None


def test_series_api_stream_summary_csv_and_validation():
    sid, s = _prepared()
    # Referencia nominal y fecha real se exportan por separado, aun si cambia el año.
    s.heat[2025]["scene"]["datetime"] = "2024-12-27T15:00:00Z"
    with patch.object(heat_series.thermal, "process_heat_year") as read, patch.object(heat_series, "process_year") as classify:
        r = client.post("/heat/timeseries", json={"session_id": sid, "years_back": 1})
    read.assert_not_called()
    classify.assert_not_called()
    lines = [json.loads(l) for l in r.text.splitlines()]
    assert lines[-1]["stage"] == "done" and lines[-1]["heat_series"]["enough"]
    params = {"session_id": sid, "years_back": 1}
    r = client.get("/heat/timeseries/summary", params=params)
    assert r.status_code == 200 and r.json()["points"][-1]["temperature_change"] == 2
    response = client.get("/heat/timeseries.csv", params=params)
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert len(rows) == 2 and rows[0]["year"] == "2025" and rows[0]["landsat_date"].startswith("2024-12")
    assert float(rows[-1]["temperature_change_c"]) == 2
    assert client.post("/heat/timeseries", json={"session_id": sid, "years_back": 11}).status_code == 422
    assert client.get("/heat/timeseries/summary", params={"session_id": "missing"}).status_code == 404
    s.class_map = None
    assert client.post("/heat/timeseries", json={"session_id": sid}).status_code == 409


def test_partial_failure_finishes_with_gaps():
    sid, s = _prepared()
    def no_scene(*args):
        raise heat_series.YearError("2024: sin escena")
    with patch.object(heat_series, "process_year", side_effect=no_scene):
        lines = [json.loads(x) for x in heat_series.heat_series_stream(sid, 2)]
    assert lines[-1]["stage"] == "done"
    r = lines[-1]["heat_series"]
    assert r["enough"] and r["points"][0]["reason"] == "2024: sin escena"


def test_model_changed_mid_series_returns_error_not_mixed_results():
    sid, s = _prepared()
    def change_model(*args):
        s.classifier = object()
        raise heat_series.YearError("changed")
    with patch.object(heat_series, "process_year", side_effect=change_model):
        lines = [json.loads(x) for x in heat_series.heat_series_stream(sid, 2)]
    assert lines[-1]["stage"] == "error" and "cambió" in lines[-1]["error"]


def test_retraining_invalidates_maps_and_old_comparisons():
    sid, s = _prepared()
    wc = np.where(np.indices(s.class_map.shape)[1] < 12, 0, 3).astype(np.int16)
    with patch("core.classifier.worldcover_labels", return_value=wc):
        lines = [json.loads(x) for x in train_stream(sid, method="worldcover")]
    assert lines[-1]["stage"] == "done", lines[-1]
    assert s.class_map is None and s.comparisons == {}
    assert 2025 in s.heat  # la LST bruta no depende del modelo de cobertura
    lines = [json.loads(x) for x in predict_stream(sid)]
    assert lines[-1]["stage"] == "done" and s.class_map is not None
