"""Series observacionales de LST y cobertura, sin ajuste ni atribución causal.

Una escena Landsat por temporada/año (no promedio anual). Todos los valores
del gráfico se calculan sobre los mismos píxeles válidos de los años elegibles.
No extrapola el área oculta por nubes ni convierte años faltantes en ceros.
"""
from __future__ import annotations

import csv
import io
import queue
import threading

import numpy as np

from core import thermal
from core.classes import primary
from core.compare import YearError, _check_session, _drain, _ndjson, pixel_area_m2, process_year, scene_year
from session_store import SessionData

MIN_COMMON_PERCENT = 50.0


def requested_years(session: SessionData, years_back: int) -> list[int]:
    current = scene_year(session)
    return list(range(max(thermal.FIRST_YEAR, current - years_back), current + 1))


def _cover(session: SessionData, year: int):
    if year == scene_year(session):
        return session.class_map, {"id": session.scene_id, "datetime": session.scene_datetime}
    entry = session.comparisons.get(year)
    # Comparaciones sin revisión conocida no se mezclan con un modelo nuevo.
    if not entry or "classifier_id" not in entry or entry["classifier_id"] != session.classifier_id:
        return None, None
    return entry["class_map"], entry["scene"]


def build_heat_series(session: SessionData, years_back: int = 10, failures: dict | None = None) -> dict:
    years = requested_years(session, years_back)
    shape = session.class_map.shape
    area = pixel_area_m2(session) / 10_000
    common = np.ones(shape, dtype=bool)
    eligible = []
    points = []
    seen_heat, seen_cover = {}, {}
    for year in years:
        heat = session.heat.get(year)
        cls, scene = _cover(session, year)
        mask = None if heat is None or cls is None else np.isfinite(heat["lst"]) & (cls >= 0)
        available = 100 * float(mask.mean()) if mask is not None else 0.0
        reason = ((failures or {}).get(year) or
                  ("Sin temperatura Landsat." if heat is None else
                   "Sin clasificación compatible con el modelo activo." if cls is None else
                   f"Menos del {MIN_COMMON_PERCENT:g} % con temperatura y cobertura válidas." if available < MIN_COMMON_PERCENT
                   else None))
        if reason is None:
            duplicate = seen_heat.get(heat["scene"]["id"]) or seen_cover.get(scene["id"])
            if duplicate is not None:
                reason = f"Escena repetida de {duplicate}; no es una observación independiente."
            else:
                seen_heat[heat["scene"]["id"]] = year
                seen_cover[scene["id"]] = year
        point = {
            "year": year, "heat_scene": heat["scene"] if heat else None, "cover_scene": scene,
            "available_percent": round(available, 2), "reason": reason,
            "temperature_mean": None, "temperature_change": None,
            "cover_hectares": None, "loss_hectares": None,
        }
        points.append(point)
        if reason is None:
            common &= mask
            eligible.append((point, heat["lst"], cls))

    common_percent = 100 * float(common.mean()) if eligible else 0.0
    enough = len(eligible) >= 2 and common_percent >= MIN_COMMON_PERCENT
    primary_learned = 0 in session.classifier.classes_
    reference = eligible[0][0]["year"] if enough else None
    if enough:
        base_temperature = float(eligible[0][1][common].mean())
        base_cover = eligible[0][2] == 0
        for point, lst, cls in eligible:
            mean = float(lst[common].mean())
            point.update(temperature_mean=round(mean, 3), temperature_change=round(mean - base_temperature, 3))
            if primary_learned:
                point.update(cover_hectares=round(float(np.count_nonzero(common & (cls == 0))) * area, 2),
                             loss_hectares=round(float(np.count_nonzero(common & base_cover & (cls != 0))) * area, 2))
    else:
        for point, _, _ in eligible:
            point["reason"] = ("Hacen falta al menos dos años válidos." if len(eligible) < 2 else
                               f"El área común a todos los años es menor del {MIN_COMMON_PERCENT:g} %.")

    return {
        "points": points, "years_back": years_back, "reference_year": reference,
        "current_year": scene_year(session), "enough": enough,
        "common_percent": round(common_percent, 2),
        "common_hectares": round(float(common.sum()) * area, 2) if eligible else 0.0,
        "total_hectares": round(float(np.prod(shape)) * area, 2),
        "min_common_percent": MIN_COMMON_PERCENT,
        "coverage_label": "Cobertura arbórea" if session.class_scheme == "worldcover" else "Vegetación",
        "primary_key": primary(session.class_scheme).key, "primary_learned": bool(primary_learned),
        "classifier_id": session.classifier_id, "method": "single_scene_unadjusted_common_support",
    }


def heat_series_stream(session_id: str, years_back: int):
    session, err = _check_session(session_id)
    if err:
        yield err
        return
    model, current_map = session.classifier, session.class_map
    years = requested_years(session, years_back)
    failures = {}
    q = queue.Queue()
    done = threading.Event()
    result = {}
    finished = [0]

    def unchanged():
        return session.classifier is model and session.class_map is current_map

    def work():
        try:
            for year in years:
                if not unchanged():
                    raise YearError("El modelo o el mapa cambió. Vuelva a calcular la serie.")
                try:
                    cls, _ = _cover(session, year)
                    if cls is None:
                        process_year(session, year, q.put)
                    if year not in session.heat:
                        thermal.process_heat_year(session, year, q.put)
                except (YearError, thermal.ThermalError) as exc:
                    failures[year] = str(exc)
                    q.put(f"{year}: {exc}")
                finished[0] += 1
                q.put(f"{year}: revisado ({finished[0]}/{len(years)}).")
            if not unchanged():
                raise YearError("El modelo o el mapa cambió. Vuelva a calcular la serie.")
            result["series"] = build_heat_series(session, years_back, failures)
        except Exception as exc:  # cierre terminal también ante errores inesperados
            result["error"] = str(exc)
        finally:
            done.set()

    threading.Thread(target=work, daemon=True).start()
    yield _ndjson("processing", 0.01, "Preparando temperatura observada y cobertura por año…")
    yield from _drain(q, done, lambda: min(0.95, finished[0] / max(1, len(years))), "processing")
    if "error" in result:
        yield _ndjson("error", 1.0, result["error"], error=result["error"])
    else:
        yield _ndjson("done", 1.0, "Serie observacional lista, sin atribución automática.", heat_series=result["series"])


def heat_series_csv(series: dict) -> str:
    out = io.StringIO()
    fields = ["year", "landsat_date", "landsat_scene", "cover_date", "cover_scene", "temperature_mean_c",
              "temperature_change_c", "cover_hectares", "loss_hectares_since_base", "reference_year",
              "available_percent", "common_percent", "common_hectares", "coverage_label", "method", "reason"]
    writer = csv.DictWriter(out, fieldnames=fields)
    writer.writeheader()
    for p in series["points"]:
        hs, cs = p["heat_scene"] or {}, p["cover_scene"] or {}
        writer.writerow(dict(year=p["year"], landsat_date=hs.get("datetime"), landsat_scene=hs.get("id"),
                             cover_date=cs.get("datetime"), cover_scene=cs.get("id"),
                             temperature_mean_c=p["temperature_mean"], temperature_change_c=p["temperature_change"],
                             cover_hectares=p["cover_hectares"], loss_hectares_since_base=p["loss_hectares"],
                             reference_year=series["reference_year"], available_percent=p["available_percent"],
                             common_percent=series["common_percent"], common_hectares=series["common_hectares"],
                             coverage_label=series["coverage_label"], method=series["method"], reason=p["reason"]))
    return out.getvalue()
