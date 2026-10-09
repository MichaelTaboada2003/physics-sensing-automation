"""
core/report.py
--------------
Exportaciones del análisis:

- ``stats_csv``       : superficie por clase y año (CSV).
- ``changes_geojson`` : polígonos de cambio entre un año y el actual (GeoJSON, EPSG:4326).
- ``report_html``     : reporte autocontenido (imágenes embebidas) listo para imprimir a PDF.
"""

from __future__ import annotations

import base64
import csv
import html
import io
import json
from datetime import datetime

import numpy as np
import rasterio.features
import rasterio.warp

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker

from core.bands import generate_true_color
from matplotlib.colors import ListedColormap

from core.compare import (
    CHANGE_LABELS,
    _rgb,
    _rgb_stretch,
    build_series,
    build_summary,
    change_map,
    pixel_area_m2,
    render_comparison,
    scene_year,
)
from core.export import CLASS_COLORS, _class_map_to_index, render_classified_map
from session_store import SessionData

_CLASS_ROWS = [("vegetation", "Vegetación"), ("water", "Agua"), ("mining", "Minería / suelo expuesto"),
               ("unclassified", "Sin datos / nube")]
_SERIES_COLORS = {"vegetation": "#16a34a", "water": "#2563eb", "mining": "#b45309"}


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

def stats_csv(session: SessionData) -> str:
    """Una fila por (año, clase) con hectáreas, % del total y % del área despejada."""
    series = build_series(session)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["year", "scene_id", "date", "clear_percent", "ndvi_mean",
                "class", "hectares", "percent_total", "percent_clear"])
    for p in series["points"]:
        for key, _label in _CLASS_ROWS:
            st = p["stats"][key]
            w.writerow([p["year"], p["scene"]["id"], p["scene"]["datetime"][:10], p["clear_percent"],
                        p["ndvi_mean"], key, st["hectares"], st["percent"],
                        "" if st["percent_clear"] is None else st["percent_clear"]])
    return buf.getvalue()


# ---------------------------------------------------------------------------
# GeoJSON de cambios
# ---------------------------------------------------------------------------

def changes_geojson(session: SessionData, year: int, min_area_ha: float = 0.5) -> dict:
    """Polígonos de cambio (pérdida/ganancia de vegetación, nuevo suelo, otro).

    Se eliminan manchas menores que *min_area_ha* con un filtro de cribado
    (``rasterio.features.sieve``) antes de vectorizar.
    """
    comp = session.comparisons[year]
    codes = change_map(comp["class_map"], session.class_map)
    codes[codes == 5] = 0  # sin datos → sin cambio
    area = pixel_area_m2(session)
    min_pixels = max(1, int(round(min_area_ha * 10_000 / area)))
    sieved = rasterio.features.sieve(codes.astype(np.uint8), size=min_pixels)

    features = []
    for geom, value in rasterio.features.shapes(sieved, mask=sieved > 0, transform=session.transform):
        value = int(value)
        geom_ll = rasterio.warp.transform_geom(session.crs, "EPSG:4326", geom, precision=6)
        n_px = _polygon_pixels(geom, session.transform)
        features.append({
            "type": "Feature",
            "geometry": geom_ll,
            "properties": {
                "change_code": value,
                "change": CHANGE_LABELS[value][1],
                "color": CHANGE_LABELS[value][0],
                "area_ha": round(n_px * area / 10_000, 3),
                "from_year": year,
                "to_year": scene_year(session),
            },
        })
    return {"type": "FeatureCollection", "features": features}


def _polygon_pixels(geom: dict, transform) -> float:
    """Área (en píxeles) de un polígono en coordenadas del CRS (fórmula del lazo)."""
    def ring_area(ring):
        x = np.array([p[0] for p in ring])
        y = np.array([p[1] for p in ring])
        return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))

    rings = geom["coordinates"]
    a = ring_area(rings[0]) - sum(ring_area(r) for r in rings[1:])
    return a / abs(transform.a * transform.e)


# ---------------------------------------------------------------------------
# Reporte HTML
# ---------------------------------------------------------------------------

def _img(data: bytes, alt: str, mime: str = "image/png") -> str:
    return f'<img alt="{html.escape(alt)}" src="data:{mime};base64,{base64.b64encode(data).decode()}">'


def _series_chart(series: dict) -> bytes:
    """Dos paneles con eje propio (sin doble eje): % por clase arriba, NDVI medio abajo."""
    pts = series["points"]
    years = [p["year"] for p in pts]
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(9, 6), dpi=110, sharex=True,
                                   gridspec_kw={"height_ratios": [2, 1]})
    ends = []
    for key, label in _CLASS_ROWS[:3]:
        ys = [np.nan if p["stats"][key]["percent_clear"] is None else p["stats"][key]["percent_clear"] for p in pts]
        ax1.plot(years, ys, marker="o", markersize=5, linewidth=2, color=_SERIES_COLORS[key], label=label)
        ends.append([ys[-1], label.split(" ")[0]])
    # Etiquetas directas al final de cada línea, separadas al menos 5 pp
    ends.sort()
    for i in range(1, len(ends)):
        ends[i][0] = max(ends[i][0], ends[i - 1][0] + 5)
    for y, text in ends:
        ax1.annotate(text, (years[-1], y), xytext=(8, 0), textcoords="offset points",
                     va="center", fontsize=8, color="#3f3f46", annotation_clip=False)
    ax1.set_ylim(0, 100)
    ax1.set_ylabel("% del área despejada")
    ax1.legend(fontsize=8, loc="lower left", bbox_to_anchor=(0, 1.0), ncol=3, frameon=False)
    ax2.plot(years, [np.nan if p["ndvi_mean"] is None else p["ndvi_mean"] for p in pts], marker="o", markersize=5, linewidth=2, color="#16a34a")
    ax2.set_ylabel("NDVI medio")
    ax2.set_xticks(years)
    for ax in (ax1, ax2):
        ax.grid(axis="y", alpha=0.25)
        ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    return buf.getvalue()


def _trend_row(label: str, t: dict | None) -> str:
    if not t:
        return f"<tr><td>{label}</td><td colspan='5'>Años insuficientes</td></tr>"
    verdict = "Sí" if t["significant"] else "No"
    return (
        f"<tr><td>{label}</td><td>{t['slope']:+.2f} pp/año</td>"
        f"<td>{t['ha_per_year']:+,.1f} ha/año [{t['ha_per_year_low']:+,.1f}, {t['ha_per_year_high']:+,.1f}]</td>"
        f"<td>{t['tau']:+.2f}</td><td>{t['p_value']:.3f}</td><td>{verdict}</td></tr>"
    )


def _fmt(v, digits=1, suffix="") -> str:
    return "—" if v is None else f"{v:,.{digits}f}{suffix}"


def report_html(session: SessionData) -> str:
    cur_year = scene_year(session)
    parts: list[str] = []
    bbox = ", ".join(f"{v:.4f}" for v in session.bbox)

    parts.append(f"""
<h1>Reporte de cobertura terrestre</h1>
<p class="meta">Generado {datetime.now().strftime('%Y-%m-%d %H:%M')} · Sentinel-2 L2A (Planetary Computer) ·
Random Forest con pseudo-etiquetado</p>
<table class="kv">
<tr><th>Zona (bbox EPSG:4326)</th><td>[{bbox}]</td></tr>
<tr><th>Escena actual</th><td>{html.escape(session.scene_id)}</td></tr>
<tr><th>Fecha</th><td>{session.scene_datetime[:10]}</td></tr>
<tr><th>Nubes (tile / zona)</th><td>{session.cloud_cover:.1f} % / {session.cloud_fraction * 100:.1f} %</td></tr>
<tr><th>Resolución</th><td>{pixel_area_m2(session) ** 0.5:.0f} m · {session.class_map.shape[1]}×{session.class_map.shape[0]} px</td></tr>
</table>""")

    parts.append('<h2>Escena actual</h2><div class="grid2">'
                 + _img(generate_true_color(session), "Color real")
                 + _img(render_classified_map(session), "Clasificación") + "</div>")

    m = session.classifier_metrics
    if m:
        rows = "".join(
            f"<tr><td>{c['class']}</td><td>{c['precision']:.3f}</td><td>{c['recall']:.3f}</td>"
            f"<td>{c['f1']:.3f}</td><td>{c['support']}</td></tr>"
            for c in m.get("per_class", [])
        )
        top = ", ".join(f"{f['feature']} ({f['importance']:.2f})" for f in m["feature_importances"][:5])
        parts.append(f"""
<h2>Clasificador</h2>
<p>OOB: <b>{m['oob_score']:.3f}</b> · Exactitud hold-out: <b>{_fmt(m.get('accuracy'), 3)}</b> ·
Kappa: <b>{_fmt(m.get('kappa'), 3)}</b> · {m['n_train']} muestras de entrenamiento, {m['n_test']} de validación.</p>
<table><tr><th>Clase</th><th>Precisión</th><th>Recall</th><th>F1</th><th>Soporte</th></tr>{rows}</table>
<p>Variables más importantes: {top}.</p>
<p class="note">La validación mide el acuerdo con las pseudo-etiquetas generadas por umbrales, no con datos de campo.</p>""")

    if session.comparisons:
        series = build_series(session)
        trows = "".join(_trend_row(label, series["trends"].get(k)) for k, label in _CLASS_ROWS[:3])
        prow = "".join(
            f"<tr><td>{p['year']}</td><td>{p['scene']['datetime'][:10]}</td><td>{p['clear_percent']:.0f} %</td>"
            + "".join(f"<td>{_fmt(p['stats'][k]['percent_clear'], 1, ' %')}</td>" for k, _ in _CLASS_ROWS[:3])
            + f"<td>{_fmt(p['ndvi_mean'], 3)}</td></tr>"
            for p in series["points"]
        )
        parts.append(f"""
<h2>Evolución temporal</h2>
{_img(_series_chart(series), 'Serie temporal')}
<table><tr><th>Año</th><th>Fecha escena</th><th>Despejado</th><th>Vegetación</th><th>Agua</th><th>Minería</th><th>NDVI medio</th></tr>{prow}</table>
<h3>Tendencias (Theil-Sen + Mann-Kendall)</h3>
<table><tr><th>Clase</th><th>Pendiente</th><th>Equivalente (IC 95 %)</th><th>τ de Kendall</th><th>p-valor</th><th>¿Significativa?</th></tr>{trows}</table>
<p class="note">Pendiente de Theil-Sen (mediana de pendientes entre pares de años) y prueba de Mann-Kendall
(α = 0.05). Porcentajes sobre el área sin nubes; las tendencias usan solo años con ≥ 50 % de la zona despejada
({', '.join(map(str, series['years_used_for_trend']))}).</p>""")

        for year in sorted(session.comparisons, reverse=True):
            s = build_summary(session, year)
            rows = "".join(
                f"<tr><td>{label}</td><td>{s['past'][k]['hectares']:,.1f}</td><td>{s['current'][k]['hectares']:,.1f}</td>"
                f"<td>{s['current'][k]['hectares'] - s['past'][k]['hectares']:+,.1f}</td></tr>"
                for k, label in _CLASS_ROWS
            )
            parts.append(f"""
<section class="page">
<h2>Comparativa {year} → {cur_year}</h2>
<p>Escena histórica {html.escape(s['past_scene']['id'])} ({s['past_scene']['datetime'][:10]}).
Píxeles comparables: {s['comparable_percent']:.1f} % · con cambio: <b>{s['changed_percent']:.1f} %</b>.</p>
{_img(render_comparison(session, year, fmt='jpeg', dpi=75), f'Comparativa {year}', 'image/jpeg')}
<table><tr><th>Clase</th><th>{year} (ha)</th><th>{cur_year} (ha)</th><th>Δ ha</th></tr>{rows}</table>
</section>""")

    body = "\n".join(parts)
    return f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reporte de cobertura terrestre</title>
<style>
body {{ font-family: system-ui, -apple-system, sans-serif; color: #18181b; background: #fff;
       max-width: 1000px; margin: 32px auto; padding: 0 16px; line-height: 1.5; }}
h1 {{ margin-bottom: 4px; }} h2 {{ border-bottom: 2px solid #e4e4e7; padding-bottom: 4px; margin-top: 36px; }}
.meta, .note {{ color: #71717a; font-size: 13px; }}
img {{ max-width: 100%; height: auto; display: block; margin: 12px 0; }}
.grid2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }}
table {{ border-collapse: collapse; width: 100%; font-size: 13px; margin: 8px 0; }}
th, td {{ border: 1px solid #e4e4e7; padding: 5px 8px; text-align: right; }}
th:first-child, td:first-child {{ text-align: left; }}
table.kv th {{ text-align: left; width: 220px; background: #fafafa; }} table.kv td {{ text-align: left; }}
@media (max-width: 700px) {{ .grid2 {{ grid-template-columns: 1fr; }} }}
@media print {{ .page {{ break-before: page; }} body {{ margin: 0; }} }}
</style></head><body>
{body}
</body></html>"""


# ---------------------------------------------------------------------------
# Imágenes para publicar (periodismo)
# ---------------------------------------------------------------------------

_INK = "#1b2430"
_MUTED = "#5f6b77"
_PAPER = "#fbfcf8"


def _es(x: float, digits: int = 1, signed: bool = False) -> str:
    """Número con coma decimal y espacio de miles (convención en español)."""
    txt = f"{x:{'+' if signed else ''},.{digits}f}"
    return txt.replace(",", " ").replace(".", ",")


def _credit(years: list[int]) -> str:
    ys_sorted = sorted(set(years))
    ys = ", ".join(str(y) for y in ys_sorted) if len(ys_sorted) <= 3 else f"{ys_sorted[0]}–{ys_sorted[-1]}"
    return f"Contiene datos modificados de Copernicus Sentinel-2 ({ys}). Clasificación: Random Forest con pseudo-etiquetado."


def _scale_bar(ax, width_px: int, pixel_m: float) -> None:
    """Barra de escala de 1, 2 o 5 km en la esquina inferior izquierda."""
    total_km = width_px * pixel_m / 1000
    km = next((k for k in (5, 2, 1, 0.5) if k <= total_km / 4), 0.5)
    bar_px = km * 1000 / pixel_m
    x0, y0 = width_px * 0.04, ax.get_ylim()[0] * 0.95
    ax.plot([x0, x0 + bar_px], [y0, y0], color="white", linewidth=4, solid_capstyle="butt")
    ax.plot([x0, x0 + bar_px], [y0, y0], color=_INK, linewidth=2, solid_capstyle="butt")
    label = f"{km:g} km"
    ax.text(x0 + bar_px / 2, y0 - width_px * 0.02, label, color="white", ha="center", va="bottom",
            fontsize=10, fontweight="bold",
            bbox={"facecolor": _INK, "edgecolor": "none", "alpha": 0.6, "pad": 1.5})


def render_before_after(session: SessionData, year: int, kind: str = "rgb", title: str = "") -> bytes:
    """Antes/después lado a lado, mismo contraste, con fechas, escala y crédito."""
    comp = session.comparisons[year]
    cur_year = scene_year(session)
    p_lo, p_hi = _rgb_stretch(session)
    if kind == "class":
        panels = [_class_map_to_index(comp["class_map"]), _class_map_to_index(session.class_map)]
        imshow_kw = {"cmap": ListedColormap(CLASS_COLORS), "vmin": 0, "vmax": 3, "interpolation": "nearest"}
    else:
        panels = [_rgb(comp["rgb"], p_lo, p_hi), _rgb(session.bands, p_lo, p_hi)]
        imshow_kw = {}
    dates = [comp["scene"]["datetime"][:10], session.scene_datetime[:10]]

    h, w = session.class_map.shape
    fig_w = 14
    fig_h = fig_w / 2 * h / w + 1.6
    fig, axes = plt.subplots(1, 2, figsize=(fig_w, fig_h), dpi=120, facecolor=_PAPER)
    for ax, img, y, d in zip(axes, panels, (year, cur_year), dates):
        ax.imshow(img, **imshow_kw)
        ax.set_title(f"{y}", loc="left", fontsize=20, fontweight="bold", color=_INK, pad=6)
        ax.text(1.0, 1.01, d, transform=ax.transAxes, ha="right", va="bottom", fontsize=11, color=_MUTED)
        ax.axis("off")
        _scale_bar(ax, w, pixel_area_m2(session) ** 0.5)
    if title:
        fig.suptitle(title, x=0.012, ha="left", fontsize=15, color=_INK, y=0.995)
    fig.text(0.012, 0.012, _credit([year, cur_year]), fontsize=9, color=_MUTED, ha="left", va="bottom")
    fig.tight_layout(rect=(0, 0.04, 1, 0.97 if title else 1))
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=_PAPER)
    plt.close(fig)
    return buf.getvalue()


def render_trend_chart(session: SessionData, title: str = "") -> bytes:
    """Serie de vegetación con la recta de Theil-Sen, su veredicto y el crédito."""
    series = build_series(session)
    pts = series["points"]
    years = [p["year"] for p in pts]
    used_years = set(series["years_used_for_trend"])
    # Años sin suficientes píxeles clasificados quedan como hueco, nunca como 0
    veg_ha = [
        (p["stats"]["vegetation"]["percent_clear"] / 100 * series["total_hectares"])
        if p["year"] in used_years and p["stats"]["vegetation"]["percent_clear"] is not None else np.nan
        for p in pts
    ]
    trend = series["trends"].get("vegetation")

    fig, ax = plt.subplots(figsize=(10, 5.4), dpi=130, facecolor=_PAPER)
    ax.set_facecolor(_PAPER)
    ax.plot(years, veg_ha, marker="o", markersize=7, linewidth=2.4, color="#16a34a",
            markeredgecolor=_PAPER, markeredgewidth=1.5, label="Vegetación (estimada)")
    if trend:
        used = [p for p in pts if p["year"] in series["years_used_for_trend"]]
        x = np.array([p["year"] for p in used], dtype=float)
        y = np.array([p["stats"]["vegetation"]["percent_clear"] / 100 * series["total_hectares"] for p in used])
        slope = trend["ha_per_year"]
        color = "#b42318" if trend["significant"] else _MUTED
        share = 100 * slope / series["total_hectares"]
        # Recta y banda del IC 95 % pivotando en la mediana (año, ha), como en la app
        xm, ym = float(np.median(x)), float(np.median(y))
        xs = np.linspace(x.min(), x.max(), 50)
        lo = ym + trend["ha_per_year_low"] * (xs - xm)
        hi = ym + trend["ha_per_year_high"] * (xs - xm)
        ax.fill_between(xs, np.minimum(lo, hi), np.maximum(lo, hi), color=color, alpha=0.12, linewidth=0,
                        label="Intervalo de confianza del 95 %")
        ax.plot(xs, ym + slope * (xs - xm), linestyle="--", linewidth=1.6, color=color,
                label=f"Tendencia Theil-Sen: {_es(slope, 1, True)} ha/año ({_es(share, 2, True)} % del área por año)")
        verdict = ("Tendencia estadísticamente significativa" if trend["significant"]
                   else "Sin tendencia estadísticamente significativa")
        ax.text(0.0, 1.02, f"{verdict} (Mann-Kendall p = {_es(trend['p_value'], 3)}; "
                f"IC 95 % {_es(trend['ha_per_year_low'], 1, True)} a {_es(trend['ha_per_year_high'], 1, True)} ha/año)",
                transform=ax.transAxes, fontsize=10, color=color, ha="left", va="bottom")
    # Eje desde cero: no exagerar visualmente un cambio de pocos puntos porcentuales
    finite = [v for v in veg_ha if np.isfinite(v)]
    ax.set_ylim(0, max(finite) * 1.08 if finite else 1)
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: _es(v, 0)))
    ax.set_ylabel("Hectáreas de vegetación", color=_INK)
    ax.set_xticks(years)
    ax.tick_params(colors=_INK)
    ax.grid(axis="y", color="#e1e5dc")
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(frameon=False, loc="lower left", fontsize=10)
    if title:
        fig.suptitle(title, x=0.012, ha="left", fontsize=15, color=_INK)
    fig.text(0.012, 0.012, _credit(years) + " Superficie estimada sobre el área sin nubes.",
             fontsize=8.5, color=_MUTED, ha="left", va="bottom")
    fig.tight_layout(rect=(0, 0.05, 1, 0.95 if title else 1))
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=_PAPER)
    plt.close(fig)
    return buf.getvalue()
