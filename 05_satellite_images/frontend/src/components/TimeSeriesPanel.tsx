import { useCallback, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  LineChart as LineChartIcon,
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
} from 'lucide-react';
import type { StreamLine, TimeSeries, Trend } from '../types';
import { useProgressStream } from '../hooks/useProgressStream';
import { CLASS_CHART_COLORS, CLASS_CHART_LABELS } from '../lib/colors';
import ProgressBar from './ProgressBar';
import LogConsole from './LogConsole';

const API_BASE = '';
const CLASS_KEYS = ['vegetation', 'water', 'mining'] as const;

const AXIS_TICK = { fill: '#a1a1aa', fontSize: 11 };
const TOOLTIP_PROPS = {
  contentStyle: { background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#e4e4e7', fontWeight: 700 },
  itemStyle: { color: '#d4d4d8' },
  cursor: { stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1 },
};

type Status = 'idle' | 'running' | 'done' | 'error';

interface TimeSeriesPanelProps {
  sessionId: string;
  sceneYear: number;
  series: TimeSeries | null;
  onSeries: (s: TimeSeries) => void;
  onSelectYear: (year: number) => void;
}

const fmt = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? '—' : v.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d });

function TrendIcon({ slope }: { slope: number }) {
  if (Math.abs(slope) < 0.05) return <Minus className="w-4 h-4 text-zinc-500" />;
  return slope > 0
    ? <TrendingUp className="w-4 h-4 text-zinc-300" />
    : <TrendingDown className="w-4 h-4 text-zinc-300" />;
}

function SignificanceBadge({ trend }: { trend: Trend }) {
  const p = trend.p_value < 0.001 ? '< 0.001' : `= ${fmt(trend.p_value, 3)}`;
  return (
    <p
      className={`inline-flex items-center gap-1.5 mt-2 px-2 py-0.5 rounded-md text-[11px] font-bold ${
        trend.significant ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 text-zinc-400'
      }`}
      title="Prueba de Mann-Kendall (α = 0.05): ¿hay una tendencia monótona o puede ser azar?"
    >
      {trend.significant ? <CheckCircle2 className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
      {trend.significant ? 'Significativa' : 'No significativa'} · p {p}
    </p>
  );
}

export default function TimeSeriesPanel({ sessionId, sceneYear, series, onSeries, onSelectYear }: TimeSeriesPanelProps) {
  const [status, setStatus] = useState<Status>(series ? 'done' : 'idle');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<StreamLine[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { consume } = useProgressStream();

  const append = useCallback((l: StreamLine) => setLogs(prev => [...prev, l]), []);

  const run = async () => {
    setStatus('running');
    setProgress(0);
    setLogs([]);
    setErrorMsg(null);
    await consume(
      `${API_BASE}/timeseries`,
      'POST',
      JSON.stringify({ session_id: sessionId, years_back: 10 }),
      l => { append(l); setProgress(l.progress); },
      l => {
        setStatus('done');
        if (l.series) onSeries(l.series);
      },
      l => { setStatus('error'); setErrorMsg(l.error ?? l.message); },
    );
  };

  const data = series?.points.map(p => ({
    year: p.year,
    vegetation: p.stats.vegetation.percent_clear,
    water: p.stats.water.percent_clear,
    mining: p.stats.mining.percent_clear,
    ndvi: p.ndvi_mean,
    clear: p.clear_percent,
  })) ?? [];

  return (
    <div className="space-y-6">
      {/* ── Intro + run ── */}
      <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/20">
            <LineChartIcon className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-200">
              Serie {sceneYear - 10}–{sceneYear}
            </h3>
            <p className="text-xs text-zinc-500">
              Procesa los 10 años anteriores en paralelo (misma temporada, escena con menos nubes en la zona)
              y estima la tendencia de cada clase con Theil-Sen y su significancia con Mann-Kendall.
            </p>
          </div>
        </div>
        <button
          onClick={run}
          disabled={status === 'running'}
          className="w-full py-4 rounded-2xl font-bold text-base transition-all shadow-lg flex items-center justify-center gap-3 bg-orange-600 hover:bg-orange-500 text-white shadow-orange-600/20 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {status === 'running' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
          {status === 'running' ? 'Procesando años…' : series ? 'Recalcular serie' : 'Calcular serie de 10 años'}
        </button>
      </div>

      {/* ── Progress ── */}
      {(status === 'running' || status === 'error') && (
        <div className="space-y-4">
          <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6">
            <div className="flex items-center gap-3 mb-4">
              {status === 'running'
                ? <Loader2 className="w-4 h-4 text-orange-400 animate-spin" />
                : <AlertCircle className="w-4 h-4 text-red-400" />}
              <span className="text-sm font-bold text-zinc-300">
                {status === 'running' ? 'Descargando y clasificando escenas históricas…' : 'Error en la serie temporal'}
              </span>
            </div>
            <ProgressBar progress={progress} label={status === 'running' ? 'Años completados' : undefined} />
          </div>
          {errorMsg && (
            <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400 font-medium">{errorMsg}</p>
            </div>
          )}
          <LogConsole lines={logs} />
        </div>
      )}

      {/* ── Results ── */}
      {series && status !== 'running' && (
        <div className="space-y-6 animate-fade-in">

          {/* Trend cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {CLASS_KEYS.map(k => {
              const t = series.trends[k];
              return (
                <div key={k} className="bg-black/30 rounded-xl p-4 border border-white/5">
                  <p className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CLASS_CHART_COLORS[k] }} />
                    {CLASS_CHART_LABELS[k]}
                  </p>
                  {t ? (
                    <>
                      <p className="flex items-center gap-2 text-xl font-mono font-bold text-zinc-100">
                        <TrendIcon slope={t.slope} />
                        {t.slope > 0 ? '+' : ''}{fmt(t.ha_per_year, 1)} ha/año
                      </p>
                      <p className="text-xs font-mono text-zinc-500 mt-1" title="Intervalo de confianza del 95 % de la pendiente de Theil-Sen">
                        IC 95 % [{fmt(t.ha_per_year_low, 1)}, {fmt(t.ha_per_year_high, 1)}] ha/año
                      </p>
                      <p className="text-xs font-mono text-zinc-500">
                        {t.slope > 0 ? '+' : ''}{fmt(t.slope, 2)} pp/año · τ {fmt(t.tau, 2)}
                      </p>
                      <SignificanceBadge trend={t} />
                    </>
                  ) : (
                    <p className="text-sm text-zinc-500">Pocos años válidos</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Class share chart */}
          <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-5">
            <p className="text-sm font-bold text-zinc-200">Cobertura por clase</p>
            <p className="text-xs text-zinc-500 mb-4">% del área sin nubes en cada escena</p>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="year" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} unit=" %" domain={[0, 100]} />
                <Tooltip {...TOOLTIP_PROPS} formatter={(v, name) => [`${fmt(Number(v), 1)} %`, name]} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#d4d4d8' }} iconType="plainline" />
                {CLASS_KEYS.map(k => (
                  <Line
                    key={k}
                    dataKey={k}
                    name={CLASS_CHART_LABELS[k]}
                    stroke={CLASS_CHART_COLORS[k]}
                    strokeWidth={2}
                    dot={{ r: 4, strokeWidth: 2, stroke: '#141416', fill: CLASS_CHART_COLORS[k] }}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: '#141416' }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* NDVI chart (separado: nunca doble eje) */}
          <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-5">
            <p className="text-sm font-bold text-zinc-200">NDVI medio de la zona</p>
            <p className="text-xs text-zinc-500 mb-4">
              {series.ndvi_trend
                ? `Theil-Sen ${series.ndvi_trend.slope > 0 ? '+' : ''}${fmt(series.ndvi_trend.slope, 4)} por año · Mann-Kendall p = ${fmt(series.ndvi_trend.p_value, 3)} (${series.ndvi_trend.significant ? 'significativa' : 'no significativa'})`
                : 'Píxeles sin nubes'}
            </p>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="year" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} domain={['auto', 'auto']} tickFormatter={v => Number(v).toFixed(2)} />
                <Tooltip {...TOOLTIP_PROPS} formatter={v => [fmt(Number(v), 3), 'NDVI medio']} />
                <Line
                  dataKey="ndvi"
                  stroke={CLASS_CHART_COLORS.vegetation}
                  strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, stroke: '#141416', fill: CLASS_CHART_COLORS.vegetation }}
                  activeDot={{ r: 6, strokeWidth: 2, stroke: '#141416' }}
                  connectNulls
                    isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Table view */}
          <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-5 overflow-x-auto">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Detalle por año</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-zinc-500 uppercase tracking-wider">
                  <th className="text-left font-bold pb-2">Año</th>
                  <th className="text-left font-bold pb-2">Escena</th>
                  <th className="text-right font-bold pb-2">Despejado</th>
                  {CLASS_KEYS.map(k => (
                    <th key={k} className="text-right font-bold pb-2">{CLASS_CHART_LABELS[k]}</th>
                  ))}
                  <th className="text-right font-bold pb-2">NDVI</th>
                  <th />
                </tr>
              </thead>
              <tbody className="font-mono">
                {series.points.map(p => {
                  const lowClear = p.clear_percent < 50;
                  return (
                    <tr key={p.year} className="border-t border-white/5">
                      <td className="py-2 font-bold text-zinc-200">{p.year}</td>
                      <td className="text-zinc-400">{p.scene.datetime.slice(0, 10)}</td>
                      <td className={`text-right ${lowClear ? 'text-amber-400' : 'text-zinc-400'}`}
                          title={lowClear ? 'Menos del 50 % despejado: excluido de la tendencia' : undefined}>
                        {fmt(p.clear_percent, 0)} %
                      </td>
                      {CLASS_KEYS.map(k => (
                        <td key={k} className="text-right text-zinc-300">{fmt(p.stats[k].percent_clear, 1)} %</td>
                      ))}
                      <td className="text-right text-zinc-300">{fmt(p.ndvi_mean, 3)}</td>
                      <td className="text-right pl-3">
                        {p.year !== sceneYear && (
                          <button
                            onClick={() => onSelectYear(p.year)}
                            className="inline-flex items-center gap-1 text-xs font-sans font-bold text-orange-400 hover:text-orange-300"
                          >
                            Comparar <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {series.failed.length > 0 && (
              <div className="mt-4 space-y-1">
                {series.failed.map(f => (
                  <p key={f.year} className="flex items-start gap-2 text-xs text-amber-400/90">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {f.error}
                  </p>
                ))}
              </div>
            )}
            <p className="flex items-start gap-2 text-xs text-zinc-600 mt-4">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              Tendencias: pendiente de Theil-Sen y prueba de Mann-Kendall (α = 0.05) con{' '}
              {series.years_used_for_trend.length} años (≥ 50 % de la zona despejada).
              Superficie total analizada: {fmt(series.total_hectares, 0)} ha.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
