"""Tests de los compuestos anuales (voto de probabilidades) y de la línea de tiempo."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException

from core import compare, sentinel
from core.test_compare import _fake_read, _lines, _make_session, client


def _scene(year: int, day: str, local: float = 1.0, tag: str = "") -> dict:
    item = SimpleNamespace(
        properties={"s2:processing_baseline": "02.09"},
        assets={a: SimpleNamespace(href=a) for a in [*sentinel.BAND_SET, sentinel.SCL_ASSET]},
    )
    return {"id": f"S{year}{day}{tag}", "datetime": f"{year}-{day}T15:00:00+00:00", "cloud_cover": 5.0,
            "local_cloud": local, "item": item}


def _year_scenes(bbox, time_range, cloud, limit=12, timeout=30):
    year = int(time_range[:4])
    if year == 2024:
        raise HTTPException(status_code=404, detail="sin escenas")
    return [_scene(year, d, i) for i, d in enumerate(["01-10", "03-05", "06-20", "08-02", "11-15"])]


class _FixedModel:
    """Modelo de juguete: la probabilidad de cada clase sale de la primera columna."""

    classes_ = np.array([0, 2])

    def predict_proba(self, X):
        p0 = np.clip(X[:, 0], 0, 1)
        return np.stack([p0, 1 - p0], axis=1)


def _obs(p0: np.ndarray, cloud: np.ndarray | None = None):
    """Observación sintética cuyo primer índice (ndvi) lleva la probabilidad de la clase 0."""
    shape = p0.shape
    mask = np.zeros(shape, dtype=bool) if cloud is None else cloud
    bands = {b: np.full(shape, 0.2, dtype=np.float32) for b in sentinel.BAND_SET}
    indices = {n: np.full(shape, 0.1, dtype=np.float32) for n in compare.compute_all_indices(bands, mask)}
    first = next(iter(indices))
    indices[first] = np.where(mask, np.nan, p0).astype(np.float32)
    indices["ndvi"] = indices[first] if first == "ndvi" else np.where(mask, np.nan, 0.5).astype(np.float32)
    return bands, mask, indices


# ---------------------------------------------------------------------------
# Voto
# ---------------------------------------------------------------------------

def test_vote_majority_beats_one_bad_scene_and_fills_clouds():
    shape = (2, 2)
    vote = compare._Vote(_FixedModel(), shape)
    good = np.full(shape, 0.9, dtype=np.float32)
    bad = np.full(shape, 0.1, dtype=np.float32)       # una escena que ve «otra clase» (p. ej. una quema)
    cloud = np.array([[True, False], [False, False]])
    never = np.array([[False, False], [False, True]])  # píxel que ninguna escena ve

    for i, (p0, mask) in enumerate([(good, cloud | never), (bad, never), (good, never)]):
        vote.add({"id": f"s{i}", "datetime": f"2020-0{i + 1}-01T00:00:00"}, *_obs(p0, mask))
    session = SimpleNamespace(classifier_id="m1")
    entry = vote.entry(session, 3)

    assert entry["n_scenes"] == 3 and entry["scenes_per_year"] == 3
    # Dos de tres escenas dicen clase 0: gana aunque una discrepe
    assert entry["class_map"][0, 1] == 0 and entry["class_map"][1, 0] == 0
    # El píxel nublado en la primera escena se decide con las otras dos (0,1 y 0,9 → empate a favor de 0)
    assert entry["class_map"][0, 0] in (0, 2)
    # Nunca observado → sin datos, y cuenta como área no clasificada
    assert entry["class_map"][1, 1] == -1 and np.isclose(entry["cloud_fraction"], 0.25)
    assert 0.5 < entry["confidence"] <= 1.0


def test_vote_stops_adding_to_settled_pixels():
    shape = (1, 2)
    vote = compare._Vote(_FixedModel(), shape)
    sure = np.array([[0.95, 0.55]], dtype=np.float32)   # el primero se resuelve; el segundo es dudoso
    for i in range(compare.VOTE_MIN_OBS):
        vote.add({"id": f"s{i}", "datetime": "2020-01-01T00:00:00"}, *_obs(sure))
    assert vote.settled.tolist() == [True, False] and not vote.done
    vote.add({"id": "s9", "datetime": "2020-09-01T00:00:00"}, *_obs(sure))
    # El píxel resuelto no vuelve a sumar; el dudoso sí
    assert vote.count.tolist() == [compare.VOTE_MIN_OBS, compare.VOTE_MIN_OBS + 1]


def test_composite_scenes_one_per_date_and_skips_overcast():
    sid, session = _make_session()
    found = [_scene(2020, "02-01", 0.5), _scene(2020, "02-01", 3.0, "b"), _scene(2020, "05-01", 2.0),
             _scene(2020, "07-01", 95.0), _scene(2020, "09-01", 10.0)]
    with patch.object(compare, "list_scenes", return_value=found):
        picked = compare.composite_scenes(session, 2020, 6)
        assert [s["id"] for s in picked] == ["S202002-01", "S202005-01", "S202009-01"]
        assert [s["id"] for s in compare.composite_scenes(session, 2020, 6, exclude_date="2020-02-01")] == \
            ["S202005-01", "S202009-01"]


# ---------------------------------------------------------------------------
# Flujo completo
# ---------------------------------------------------------------------------

def test_timeseries_with_annual_composites_end_to_end():
    sid, session = _make_session()
    raw_map = session.class_map
    with patch.object(compare, "list_scenes", side_effect=_year_scenes), \
         patch.object(compare, "read_on_grid", side_effect=_fake_read):
        lines = _lines(client.post("/timeseries", json={"session_id": sid, "years_back": 4, "scenes_per_year": 3}))
    done = lines[-1]
    assert done["stage"] == "done", done
    series = done["series"]
    assert series["scenes_per_year"] == 3
    assert [p["year"] for p in series["points"]] == [2022, 2023, 2025, 2026]
    assert [f["year"] for f in series["failed"]] == [2024]
    assert all(p["n_scenes"] == 3 and len(p["scene_dates"]) == 3 for p in series["points"])

    # El año actual también es un compuesto, sin tocar el mapa de la escena elegida
    assert session.class_map is raw_map
    assert session.current_composite is not None and session.active_map() is session.current_composite["class_map"]
    assert session.current_composite["scenes"][0]["id"] == "CUR"

    # Eventos estructurados para la matriz de avance
    events = [l["event"] for l in lines if "event" in l]
    assert events[0]["plan"]["scenes_per_year"] == 3 and 2026 in events[0]["plan"]["years"]
    assert any(e.get("scene_index") == 2 and e.get("scenes_total") == 3 for e in events)
    assert {e["year"] for e in events if e.get("year_done")} == {2022, 2023, 2025, 2026}
    assert [e["year"] for e in events if e.get("year_failed")] == [2024]

    stats = client.get("/map/stats", params={"session_id": sid}).json()
    assert stats["n_scenes"] == 3 and stats["scenes_per_year"] == 3

    # El año actual se puede pedir como capa (cuadro final de la línea de tiempo)
    for kind in ("rgb", "class", "ndvi"):
        assert client.get("/layer", params={"session_id": sid, "kind": kind, "year": 2026}).status_code == 200
    assert client.get("/layer", params={"session_id": sid, "kind": "change", "year": 2026}).status_code == 400
    assert client.get("/layer", params={"session_id": sid, "kind": "change", "year": 2022}).status_code == 200

    summary = client.get("/compare/summary", params={"session_id": sid, "year": 2022}).json()
    assert summary["past_n_scenes"] == 3 and summary["current_n_scenes"] == 3

    for kind in ("rgb", "class"):
        gif = client.get("/export/timelapse.gif", params={"session_id": sid, "kind": kind, "title": "El Bagre"})
        assert gif.status_code == 200 and gif.content[:6] == b"GIF89a"
    ba = client.get("/export/beforeafter.png", params={"session_id": sid, "year": 2022})
    assert ba.status_code == 200
    assert "compuesto" in client.get("/export/report.html", params={"session_id": sid}).text
    csv_text = client.get("/export/stats.csv", params={"session_id": sid}).text
    assert csv_text.split("\n")[0].strip().endswith("n_scenes,scene_dates") and "2022-01-10 2022-03-05" in csv_text


def test_changing_method_discards_years_measured_with_the_other():
    sid, session = _make_session()
    with patch.object(compare, "list_scenes", side_effect=_year_scenes), \
         patch.object(compare, "read_on_grid", side_effect=_fake_read):
        _lines(client.post("/compare", json={"session_id": sid, "year": 2023, "scenes_per_year": 3}))
        assert session.comparisons[2023]["n_scenes"] == 3 and session.current_composite is not None
        # Volver a una sola escena: nada de lo anterior es comparable
        with patch.object(compare, "best_scene", side_effect=lambda b, tr, c: _scene(2022, "07-10")):
            lines = _lines(client.post("/compare", json={"session_id": sid, "year": 2022, "scenes_per_year": 1}))
    assert lines[-1]["stage"] == "done", lines[-1]
    assert set(session.comparisons) == {2022} and session.current_composite is None
    assert session.active_map() is session.class_map
    assert client.post("/timeseries", json={"session_id": sid, "scenes_per_year": 4}).status_code == 400


def test_timelapse_needs_two_years():
    sid, _ = _make_session()
    assert client.get("/export/timelapse.gif", params={"session_id": sid}).status_code == 409


def test_single_scene_stream_carries_year_events():
    sid, _ = _make_session()
    with patch.object(compare, "best_scene", side_effect=lambda b, tr, c: _scene(int(tr[:4]), "07-10")), \
         patch.object(compare, "read_on_grid", side_effect=_fake_read):
        lines = _lines(client.post("/timeseries", json={"session_id": sid, "years_back": 2}))
    events = [l["event"] for l in lines if "event" in l]
    assert events[0]["plan"] == {"years": [2024, 2025], "cached": [], "scenes_per_year": 1, "current_year": 2026}
    assert sorted(e["year"] for e in events if e.get("year_done")) == [2024, 2025]
    assert all(p["n_scenes"] == 1 for p in lines[-1]["series"]["points"])
