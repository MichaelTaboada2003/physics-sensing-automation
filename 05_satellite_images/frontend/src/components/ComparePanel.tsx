import { useState, useCallback } from 'react';
import type { LayerKind, TimeSeries } from '../types';
import { useLayerBounds } from '../hooks/useLayerBounds';
import SwipeMap from './map/SwipeMap';
import LayerControls from './map/LayerControls';
import TimeSeriesPanel from './TimeSeriesPanel';
import {
  History,
  Play,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Calendar,
  Cloud,
  ArrowRight,
  Info,
  Download,
  FileText,
  CalendarRange,
  LineChart as LineChartIcon,
} from 'lucide-react';
import type { StreamLine, ComparisonSummary, ClassKey } from '../types';
import { useProgressStream } from '../hooks/useProgressStream';
import ProgressBar from './ProgressBar';
import LogConsole from './LogConsole';

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = '';
const MAX_YEARS_BACK = 10;

const CLASS_ROWS: { key: ClassKey; label: string; color: string }[] = [
  { key: 'vegetation',   label: 'Vegetación',           color: 'bg-green-600' },
  { key: 'water',        label: 'Agua',                 color: 'bg-blue-600'  },
  { key: 'mining',       label: 'Minería / Suelo exp.', color: 'bg-amber-800' },
  { key: 'unclassified', label: 'Sin datos / nube',     color: 'bg-zinc-900'  },
];

type Tab = 'year' | 'series';

// Índices en la matriz de transiciones (orden del backend)
const T = { veg: 0, water: 1, mining: 2 } as const;

// ── Types ──────────────────────────────────────────────────────────────────────

type CompareStatus = 'idle' | 'running' | 'done' | 'error';

interface ComparePanelProps {
  sessionId: string;
  sceneYear: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtHa = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });

const signed = (n: number, digits = 1) =>
  `${n > 0 ? '+' : ''}${n.toLocaleString('es-ES', { maximumFractionDigits: digits })}`;

const deltaColor = (n: number) =>
  n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-zinc-500';

// ── Component ──────────────────────────────────────────────────────────────────

export default function ComparePanel({ sessionId, sceneYear }: ComparePanelProps) {
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
  const [opacity, setOpacity] = useState(1);
  const { bounds } = useLayerBounds(sessionId);

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

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-4xl mx-auto animate-fade-in space-y-6">

      {/* ── Tabs ── */}
      <div className="flex gap-1.5 bg-zinc-900/40 p-1.5 rounded-2xl border border-white/5">
        {([
          { id: 'year' as Tab, label: 'Comparar un año', icon: CalendarRange },
          { id: 'series' as Tab, label: 'Serie de 10 años', icon: LineChartIcon },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-colors ${
              tab === t.id ? 'bg-orange-600 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'series' && (
        <TimeSeriesPanel
          sessionId={sessionId}
          sceneYear={sceneYear}
          series={series}
          onSeries={setSeries}
          onSelectYear={showYear}
        />
      )}

      {tab === 'year' && (<>
      {/* ── Year selector ── */}
      <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/20">
            <History className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-200">Año a comparar con {sceneYear}</h3>
            <p className="text-xs text-zinc-500">
              Misma temporada (±60 días), escena con menos nubes en la zona, clasificada con el modelo actual
            </p>
          </div>
        </div>

        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
          {years.map(y => (
            <button
              key={y}
              onClick={() => (processedYears.has(y) ? showYear(y) : setSelectedYear(y))}
              disabled={status === 'running'}
              className={`relative py-2 rounded-xl text-sm font-mono font-bold border transition-all ${
                selectedYear === y
                  ? 'bg-orange-500 text-white border-orange-400 shadow-lg shadow-orange-500/20'
                  : 'bg-black/30 text-zinc-400 border-white/5 hover:text-zinc-200 hover:bg-white/5'
              } disabled:opacity-50`}
            >
              {y}
              {processedYears.has(y) && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-zinc-900" />
              )}
            </button>
          ))}
        </div>

        {years.some(y => y < 2017) && (
          <div className="flex items-start gap-2 text-xs text-zinc-500">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Sentinel-2 L2A tiene cobertura irregular antes de 2017; algunos años antiguos pueden no
              tener escenas disponibles.
            </span>
          </div>
        )}

        <button
          onClick={handleCompare}
          disabled={status === 'running'}
          className="w-full py-4 rounded-2xl font-bold text-base transition-all shadow-lg flex items-center justify-center gap-3 bg-orange-600 hover:bg-orange-500 text-white shadow-orange-600/20 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {status === 'running' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
          {status === 'running' ? 'Comparando…' : `Comparar ${selectedYear} vs ${sceneYear}`}
        </button>
      </div>

      {/* ── Progress ── */}
      {status !== 'idle' && (
        <div className="space-y-4">
          <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6">
            <div className="flex items-center gap-3 mb-4">
              {status === 'running' && <Loader2 className="w-4 h-4 text-orange-400 animate-spin" />}
              {status === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              {status === 'error' && <AlertCircle className="w-4 h-4 text-red-400" />}
              <span className="text-sm font-bold text-zinc-300">
                {status === 'running' && 'Procesando escena histórica…'}
                {status === 'done' && 'Comparativa completada'}
                {status === 'error' && 'Error en la comparativa'}
              </span>
            </div>
            <ProgressBar progress={progress} label={status === 'running' ? 'Progreso' : undefined} />
          </div>

          {status === 'error' && errorMsg && (
            <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400 font-medium">{errorMsg}</p>
            </div>
          )}

          <LogConsole lines={logs} />
        </div>
      )}

      {/* ── Results ── */}
      {active && (
        <div className="space-y-6 animate-fade-in">

          {/* Year tabs (when several comparisons exist) */}
          {computedYears.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mr-1">
                Comparativas
              </span>
              {computedYears.map(y => (
                <button
                  key={y}
                  onClick={() => setActiveYear(y)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition-colors ${
                    activeYear === y
                      ? 'bg-zinc-200 text-zinc-900 border-zinc-200'
                      : 'bg-black/30 text-zinc-400 border-white/5 hover:text-zinc-200'
                  }`}
                >
                  {y} → {sceneYear}
                </button>
              ))}
            </div>
          )}

          {/* Scene metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
            {[active.past_scene, active.current_scene].map((scene, i) => (
              <div key={scene.id} className={`bg-black/30 rounded-xl p-4 border border-white/5 ${i === 1 ? 'sm:order-3' : ''}`}>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
                  {i === 0 ? 'Escena histórica' : 'Escena actual'}
                </p>
                <div className="flex items-center gap-4 text-sm font-mono">
                  <span className="flex items-center gap-1.5 text-zinc-200">
                    <Calendar className="w-3.5 h-3.5 text-zinc-600" />
                    {scene.datetime.slice(0, 10)}
                  </span>
                  <span className="flex items-center gap-1.5 text-blue-400">
                    <Cloud className="w-3.5 h-3.5 text-zinc-600" />
                    {scene.local_cloud != null
                      ? `${scene.local_cloud.toFixed(1)} % en la zona`
                      : `${scene.cloud_cover.toFixed(1)} %`}
                  </span>
                </div>
                <p className="text-[10px] font-mono text-zinc-600 break-all mt-2">{scene.id}</p>
              </div>
            ))}
            <ArrowRight className="w-5 h-5 text-zinc-600 mx-auto hidden sm:block sm:order-2" />
          </div>

          {/* Interactive before/after map */}
          {bounds && (
            <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-4 space-y-3">
              <LayerControls
                kinds={['rgb', 'class', 'ndvi', 'change']}
                kind={layerKind}
                onKind={setLayerKind}
                opacity={opacity}
                onOpacity={setOpacity}
              />
              {layerKind === 'change' ? (
                <SwipeMap
                  bounds={bounds}
                  after={{
                    url: `${API_BASE}/layer?session_id=${sessionId}&kind=change&year=${active.year}`,
                    label: `Cambios ${active.year} → ${sceneYear}`,
                  }}
                  opacity={opacity}
                />
              ) : (
                <SwipeMap
                  bounds={bounds}
                  before={{
                    url: `${API_BASE}/layer?session_id=${sessionId}&kind=${layerKind}&year=${active.year}`,
                    label: String(active.year),
                  }}
                  after={{
                    url: `${API_BASE}/layer?session_id=${sessionId}&kind=${layerKind}`,
                    label: String(sceneYear),
                  }}
                  opacity={opacity}
                />
              )}
              <p className="text-xs text-zinc-500">
                {layerKind === 'change'
                  ? 'Rojo: pérdida de vegetación · verde: ganancia · ámbar: nuevo suelo expuesto · violeta: otro cambio.'
                  : 'Arrastra el divisor para comparar ambos años sobre la imagen satelital.'}
              </p>
            </div>
          )}

          {/* Comparison figure */}
          <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-4">
            <img
              key={`${sessionId}-${active.year}`}
              src={`${API_BASE}/compare/image?session_id=${sessionId}&year=${active.year}`}
              alt={`Comparativa temporal ${active.year} vs ${sceneYear}`}
              className="w-full h-auto rounded-xl bg-white"
            />
          </div>

          {/* Stats table */}
          <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6 overflow-x-auto">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">
              Superficie por clase (ha)
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-zinc-500 uppercase tracking-wider">
                  <th className="text-left font-bold pb-3">Clase</th>
                  <th className="text-right font-bold pb-3">{active.year}</th>
                  <th className="text-right font-bold pb-3">{sceneYear}</th>
                  <th className="text-right font-bold pb-3">Δ ha</th>
                  <th className="text-right font-bold pb-3">Δ pp</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {CLASS_ROWS.map(({ key, label, color }) => {
                  const p = active.past[key];
                  const c = active.current[key];
                  const dHa = c.hectares - p.hectares;
                  const dPct = c.percent - p.percent;
                  return (
                    <tr key={key} className="border-t border-white/5">
                      <td className="py-2.5 font-sans">
                        <span className="flex items-center gap-2 text-zinc-300">
                          <span className={`w-3 h-3 rounded-sm ${color} border border-white/10`} />
                          {label}
                        </span>
                      </td>
                      <td className="text-right text-zinc-400">
                        {fmtHa(p.hectares)} <span className="text-zinc-600 text-xs">({p.percent.toFixed(1)}%)</span>
                      </td>
                      <td className="text-right text-zinc-200">
                        {fmtHa(c.hectares)} <span className="text-zinc-600 text-xs">({c.percent.toFixed(1)}%)</span>
                      </td>
                      <td className={`text-right font-bold ${deltaColor(dHa)}`}>{signed(dHa)}</td>
                      <td className={`text-right ${deltaColor(dPct)}`}>{signed(dPct, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Key transitions */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Píxeles con cambio', value: `${active.changed_percent.toFixed(1)} %` },
              { label: 'Vegetación → Minería', value: `${fmtHa(active.transitions[T.veg][T.mining] * active.pixel_area_m2 / 10_000)} ha` },
              { label: 'Vegetación → Agua',    value: `${fmtHa(active.transitions[T.veg][T.water] * active.pixel_area_m2 / 10_000)} ha` },
              { label: 'Minería → Vegetación', value: `${fmtHa(active.transitions[T.mining][T.veg] * active.pixel_area_m2 / 10_000)} ha` },
            ].map(({ label, value }) => (
              <div key={label} className="bg-black/30 rounded-xl p-4 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
                <p className="text-lg font-mono font-bold text-zinc-100">{value}</p>
              </div>
            ))}
          </div>

          {/* Downloads */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href={`${API_BASE}/export/changes.geojson?session_id=${sessionId}&year=${active.year}`}
              className="flex items-center justify-center gap-2 py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-sm rounded-xl border border-white/10 transition-all active:scale-[0.98]"
            >
              <Download className="w-4 h-4" />
              Polígonos de cambio (GeoJSON)
            </a>
            <a
              href={`${API_BASE}/export/report.html?session_id=${sessionId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 py-3 px-4 bg-zinc-100 hover:bg-white text-zinc-900 font-bold text-sm rounded-xl transition-all active:scale-[0.98]"
            >
              <FileText className="w-4 h-4" />
              Reporte con todas las comparativas
            </a>
          </div>

          <p className="text-xs text-zinc-600 leading-relaxed">
            Ambas escenas se convierten a reflectancia de superficie (corrigiendo el offset del processing
            baseline 04.00), se alinean sobre la misma grilla de 10 m y se clasifican con el mismo Random Forest.
            Nubes, sombras y nieve (capa SCL) se excluyen: aparecen como "sin datos" y no cuentan como cambio.
          </p>
        </div>
      )}
      </>)}
    </div>
  );
}
