import { useState, useCallback } from 'react';
import type { LayerKind, TimeSeries } from '../types';
import { useLayerBounds } from '../hooks/useLayerBounds';
import SwipeMap from './map/SwipeMap';
import LayerControls from './map/LayerControls';
import TimeSeriesPanel from './TimeSeriesPanel';
import { Play, Loader2, Download, FileText, CalendarRange, Image as ImageIcon, LineChart as LineChartIcon } from 'lucide-react';
import type { StreamLine, ComparisonSummary, ClassDef, Zone } from '../types';
import { RULES_DEFS, phrase } from '../lib/classes';
import { useProgressStream } from '../hooks/useProgressStream';
import { useMapStats } from '../hooks/useMapStats';
import TaskProgress from './TaskProgress';
import MapLegend from './MapLegend';
import SpecimenLabel from './SpecimenLabel';
import type { DeterminationSlip } from './SpecimenLabel';

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = '';
const MAX_YEARS_BACK = 10;


type Tab = 'year' | 'series';

// Transiciones de interés, por clave de clase ('P' = clase principal: vegetación o bosque)
const TRANSITION_PAIRS: [string, string][] = [
  ['P', 'mining'], ['P', 'urban'], ['P', 'grass'], ['P', 'water'], ['mining', 'P'], ['grass', 'P'], ['water', 'P'],
];
// ── Types ──────────────────────────────────────────────────────────────────────

type CompareStatus = 'idle' | 'running' | 'done' | 'error';

interface ComparePanelProps {
  sessionId: string;
  sceneYear: number;
  zone: Zone | null;
  sceneInfo: { id: string; datetime: string } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtHa = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 1 });

const signed = (n: number, digits = 1) =>
  `${n > 0 ? '+' : ''}${n.toLocaleString('es-CO', { maximumFractionDigits: digits })}`;

// ── Component ──────────────────────────────────────────────────────────────────

export default function ComparePanel({ sessionId, sceneYear, zone, sceneInfo }: ComparePanelProps) {
  const years = Array.from({ length: MAX_YEARS_BACK }, (_, i) => sceneYear - 1 - i);

  const [selectedYear, setSelectedYear] = useState<number>(sceneYear - 5);
  const [status, setStatus] = useState<CompareStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<StreamLine[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [results, setResults] = useState<Record<number, ComparisonSummary>>({});
  const [activeYear, setActiveYear] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('year');
  const [series, setSeries] = useState<TimeSeries | null>(null);
  const [layerKind, setLayerKind] = useState<LayerKind>('rgb');
  const [grid, setGrid] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const { bounds } = useLayerBounds(sessionId);
  const stats = useMapStats(sessionId, 'compare');

  const { consume } = useProgressStream();

  // Años ya procesados en el backend (por comparativa individual o por la serie)
  const processedYears = new Set<number>([
    ...Object.keys(results).map(Number),
    ...(series?.points.map(p => p.year).filter(y => y !== sceneYear) ?? []),
  ]);

  const showYear = async (year: number) => {
    setTab('year');
    setSelectedYear(year);
    if (results[year]) {
      setActiveYear(year);
      return;
    }
    const res = await fetch(`${API_BASE}/compare/summary?session_id=${sessionId}&year=${year}`);
    if (res.ok) {
      const summary: ComparisonSummary = await res.json();
      setResults(prev => ({ ...prev, [year]: summary }));
      setActiveYear(year);
    }
  };

  const appendLog = useCallback((line: StreamLine) => {
    setLogs(prev => [...prev, line]);
  }, []);

  const handleCompare = async () => {
    const year = selectedYear;
    setStatus('running');
    setProgress(0);
    setLogs([]);
    setErrorMsg(null);

    await consume(
      `${API_BASE}/compare`,
      'POST',
      JSON.stringify({ session_id: sessionId, year }),
      (line) => {
        appendLog(line);
        setProgress(line.progress);
      },
      (line) => {
        setProgress(1);
        setStatus('done');
        if (line.comparison) {
          const summary = line.comparison;
          setResults(prev => ({ ...prev, [year]: summary }));
          setActiveYear(year);
        }
      },
      (line) => {
        setStatus('error');
        setErrorMsg(line.error ?? line.message);
      },
    );
  };

  const active = activeYear !== null ? results[activeYear] : null;
  const computedYears = Object.keys(results).map(Number).sort((a, b) => b - a);

  // Clases del esquema con que se entrenó (reglas o WorldCover)
  const defs: ClassDef[] = series?.classes ?? active?.classes ?? stats?.class_defs ?? RULES_DEFS;
  const main = defs[0];
  const valuesOf = (st: Record<string, { percent_clear: number | null }>) =>
    Object.fromEntries(defs.map(d => [d.key, st[d.key]?.percent_clear ?? null]));

  // Fichas de determinación para la etiqueta: serie (si existe) + comparativas sueltas
  const slipsByYear = new Map<number, DeterminationSlip>();
  for (const [y, r] of Object.entries(results)) {
    slipsByYear.set(Number(y), { year: Number(y), date: r.past_scene.datetime.slice(0, 10), values: valuesOf(r.past) });
  }
  for (const p of series?.points ?? []) {
    if (p.year === sceneYear) continue;
    slipsByYear.set(p.year, { year: p.year, date: p.scene.datetime.slice(0, 10), values: valuesOf(p.stats) });
  }
  const slips = [...slipsByYear.values()];
  const currentPoint = series?.points.find(p => p.year === sceneYear);

  const labelProps = zone && {
    zone,
    scene: sceneInfo,
    cloudFraction: stats?.cloud_fraction,
    classes: stats?.classes ?? currentPoint?.stats,
    classDefs: defs,
    slips,
    vegetationTrend: series?.trends[main.key],
  };
  const label = labelProps && <SpecimenLabel {...labelProps} />;
  // Dentro del mapa caben menos fichas
  const mapLabel = labelProps && <SpecimenLabel {...labelProps} maxSlips={2} />;

  const vegPast = active?.past[main.key]?.hectares ?? 0;
  const vegNow = active?.current[main.key]?.hectares ?? 0;

  // Posición de cada clase en la matriz de transiciones (orden del esquema + «sin datos»)
  const rowOf = (key: string) => (key === 'P' ? 0 : defs.findIndex(d => d.key === key));
  const transitions = TRANSITION_PAIRS
    .filter(([a, b]) => rowOf(a) >= 0 && rowOf(b) >= 0)
    .map(([a, b]) => ({
      label: `${(a === 'P' ? main : defs[rowOf(a)]).label} → ${(b === 'P' ? main : defs[rowOf(b)]).label.toLowerCase()}`,
      from: rowOf(a),
      to: rowOf(b),
    }));

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="segmented" role="tablist" aria-label="Tipo de comparación">
        {([
          { id: 'year' as Tab, label: 'Comparar un año', icon: CalendarRange },
          { id: 'series' as Tab, label: 'Serie de 10 años', icon: LineChartIcon },
        ]).map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className="inline-flex items-center gap-2"
          >
            <t.icon className="w-4 h-4" aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'series' && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] items-start">
          <div className="min-w-0">
            <TimeSeriesPanel
              sessionId={sessionId}
              sceneYear={sceneYear}
              zoneName={zone?.name ?? ''}
              series={series}
              onSeries={setSeries}
              onSelectYear={showYear}
            />
          </div>
          {label && <div className="xl:sticky xl:top-8">{label}</div>}
        </div>
      )}

      {tab === 'year' && (
        <>
          <section className="sheet p-4 space-y-3" aria-labelledby="year-title">
            <div>
              <h2 id="year-title" className="font-serif text-xl font-semibold">Año a comparar con {sceneYear}</h2>
              <p className="text-sm text-ink-2 mt-1">
                Misma temporada (±60 días), la escena con menos nubes en la zona, clasificada con el mismo modelo.
              </p>
            </div>
            <div className="segmented flex-wrap" role="group" aria-label="Año">
              {years.map(y => (
                <button
                  key={y}
                  type="button"
                  aria-pressed={selectedYear === y}
                  onClick={() => (processedYears.has(y) ? showYear(y) : setSelectedYear(y))}
                  disabled={status === 'running'}
                  className="figure relative"
                >
                  {y}
                  {processedYears.has(y) && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-stamp" aria-label="calculado" />
                  )}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={handleCompare} disabled={status === 'running'} className="btn btn-primary">
                {status === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Comparar <span className="figure">{selectedYear}</span> con <span className="figure">{sceneYear}</span>
              </button>
              {years.some(y => y < 2017) && (
                <p className="text-sm text-muted">Antes de 2017 hay pocas imágenes Sentinel-2 disponibles.</p>
              )}
            </div>
          </section>

          <TaskProgress
            status={status}
            progress={progress}
            lines={logs}
            error={errorMsg}
            titles={{
              running: `Procesando ${selectedYear}…`,
              done: 'Comparativa lista',
              error: `No se pudo comparar ${selectedYear}`,
            }}
          />

          {active && (
            <div className="space-y-6 animate-fade-in">
              {computedYears.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-ink-2">Comparativas calculadas:</span>
                  {computedYears.map(y => (
                    <button
                      key={y}
                      onClick={() => setActiveYear(y)}
                      aria-pressed={activeYear === y}
                      className={`figure px-2 py-1 rounded-[3px] border ${
                        activeYear === y ? 'border-stamp bg-stamp-tint text-stamp-2 font-bold' : 'border-rule hover:border-rule-strong'
                      }`}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              )}

              <section className="sheet overflow-hidden" aria-label="Mapa antes y después">
                <div className="p-3 border-b border-rule bg-paper-2 space-y-2.5">
                  <LayerControls
                    kinds={['rgb', 'class', 'ndvi', 'change']}
                    kind={layerKind}
                    onKind={setLayerKind}
                    opacity={opacity}
                    onOpacity={setOpacity}
                    graticule={grid}
                    onGraticule={setGrid}
                  />
                  <MapLegend kind={layerKind} classDefs={defs} />
                </div>
                {bounds && (
                  layerKind === 'change' ? (
                    <SwipeMap
                      bounds={bounds}
                      after={{ url: `${API_BASE}/layer?session_id=${sessionId}&kind=change&year=${active.year}`, label: 'Cambios' }}
                      opacity={opacity}
                      graticule={grid}
                      height="h-[440px] lg:h-[600px]"
                    >
                      {mapLabel && <div className="hidden sm:block">{mapLabel}</div>}
                    </SwipeMap>
                  ) : (
                    <SwipeMap
                      bounds={bounds}
                      before={{ url: `${API_BASE}/layer?session_id=${sessionId}&kind=${layerKind}&year=${active.year}`, label: String(active.year) }}
                      after={{ url: `${API_BASE}/layer?session_id=${sessionId}&kind=${layerKind}`, label: String(sceneYear) }}
                      opacity={opacity}
                      graticule={grid}
                      height="h-[440px] lg:h-[600px]"
                    >
                      {mapLabel && <div className="hidden sm:block">{mapLabel}</div>}
                    </SwipeMap>
                  )
                )}
                <p className="px-4 py-2.5 border-t border-rule text-sm text-ink-2">
                  {layerKind === 'change'
                    ? 'Solo se pintan los píxeles que cambiaron de clase; las nubes no cuentan como cambio.'
                    : <>Arrastra el divisor: a la izquierda <span className="figure">{active.year}</span>, a la derecha <span className="figure">{sceneYear}</span>.</>}
                </p>
              </section>

              {label && <div className="sm:hidden">{label}</div>}

              <section className="space-y-3" aria-labelledby="what-title">
                <h2 id="what-title" className="font-serif text-xl font-semibold">
                  Qué cambió entre <span className="figure">{active.year}</span> y <span className="figure">{sceneYear}</span>
                </h2>
                <p className="max-w-[70ch] text-ink-2">
                  {phrase(main).charAt(0).toUpperCase() + phrase(main).slice(1)} pasó de <span className="figure text-ink font-bold">{fmtHa(vegPast)} ha</span> a{' '}
                  <span className="figure text-ink font-bold">{fmtHa(vegNow)} ha</span>{' '}
                  (<span className={`figure font-bold ${vegNow < vegPast ? 'text-signal' : 'text-ink'}`}>{signed(vegNow - vegPast)} ha</span>).
                  El <span className="figure text-ink font-bold">{active.changed_percent.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %</span> de
                  los píxeles comparables cambió de clase. Una sola comparación no basta para hablar de tendencia: usa la serie de 10 años.
                </p>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="sheet overflow-x-auto">
                    <table className="data-table">
                      <caption className="sr-only">Superficie por clase en hectáreas</caption>
                      <thead>
                        <tr>
                          <th scope="col">Clase</th>
                          <th scope="col" className="!text-right figure">{active.year}</th>
                          <th scope="col" className="!text-right figure">{sceneYear}</th>
                          <th scope="col" className="!text-right">Δ ha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...defs.map(d => ({ key: d.key, label: d.label, color: d.color })),
                          { key: 'unclassified', label: 'Sin datos / nube', color: '#1b2430' }].map(({ key, label: name, color }) => {
                          const d = active.current[key].hectares - active.past[key].hectares;
                          return (
                            <tr key={key}>
                              <td>
                                <span className="flex items-center gap-2">
                                  <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: color }} aria-hidden />
                                  {name}
                                </span>
                              </td>
                              <td className="num">{fmtHa(active.past[key].hectares)}</td>
                              <td className="num">{fmtHa(active.current[key].hectares)}</td>
                              <td className={`num font-bold ${key === main.key && d < 0 ? 'text-signal' : ''}`}>{signed(d)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="sheet overflow-x-auto">
                    <table className="data-table">
                      <caption className="sr-only">Transiciones principales</caption>
                      <thead>
                        <tr>
                          <th scope="col">Transición</th>
                          <th scope="col" className="!text-right">Superficie</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transitions.map(t => (
                          <tr key={t.label}>
                            <td>{t.label}</td>
                            <td className="num">
                              {fmtHa(active.transitions[t.from][t.to] * active.pixel_area_m2 / 10_000)} ha
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              <details className="sheet">
                <summary className="cursor-pointer px-4 py-3 font-semibold">Figura comparativa completa</summary>
                <img
                  key={`${sessionId}-${active.year}`}
                  src={`${API_BASE}/compare/image?session_id=${sessionId}&year=${active.year}`}
                  alt={`Color real, ΔNDVI, clasificación y mapa de cambios ${active.year}–${sceneYear}`}
                  loading="lazy"
                  className="w-full h-auto border-t border-rule bg-white"
                />
              </details>

              <div className="flex flex-wrap gap-3">
                <a
                  href={`${API_BASE}/export/beforeafter.png?session_id=${sessionId}&year=${active.year}&kind=rgb&title=${encodeURIComponent(zone?.name ?? '')}`}
                  download
                  className="btn btn-primary"
                >
                  <ImageIcon className="w-4 h-4" />
                  Imagen antes/después para publicar
                </a>
                <a
                  href={`${API_BASE}/export/beforeafter.png?session_id=${sessionId}&year=${active.year}&kind=class&title=${encodeURIComponent(zone?.name ?? '')}`}
                  download
                  className="btn btn-secondary"
                >
                  <ImageIcon className="w-4 h-4" />
                  Antes/después clasificado
                </a>
                <a href={`${API_BASE}/export/changes.geojson?session_id=${sessionId}&year=${active.year}`} className="btn btn-secondary">
                  <Download className="w-4 h-4" />
                  Polígonos de cambio (GeoJSON)
                </a>
                <a href={`${API_BASE}/export/report.html?session_id=${sessionId}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                  <FileText className="w-4 h-4" />
                  Reporte con todas las comparativas
                </a>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
