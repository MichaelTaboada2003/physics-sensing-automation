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
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Image as ImageIcon,
} from 'lucide-react';
import type { StreamLine, TimeSeries, Trend } from '../types';
import { useProgressStream } from '../hooks/useProgressStream';
import { RULES_DEFS, chartColor, phrase } from '../lib/classes';
import TaskProgress from './TaskProgress';

const API_BASE = '';

const AXIS_TICK = { fill: '#3d4856', fontSize: 12, fontFamily: 'Courier Prime, monospace' };
const TOOLTIP_PROPS = {
  contentStyle: { background: '#fbfcf8', border: '1px solid #cdd3c8', borderRadius: 4, fontSize: 13 },
  labelStyle: { color: '#1b2430', fontWeight: 700 },
  itemStyle: { color: '#3d4856' },
  cursor: { stroke: '#aab3a6', strokeWidth: 1 },
};
const GRID_STROKE = '#e1e5dc';
const DOT_RING = '#fbfcf8';

type Status = 'idle' | 'running' | 'done' | 'error';

interface TimeSeriesPanelProps {
  sessionId: string;
  sceneYear: number;
  zoneName: string;
  series: TimeSeries | null;
  onSeries: (s: TimeSeries) => void;
  onSelectYear: (year: number) => void;
}

const fmt = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: d });

const fmtP = (p: number) => (p < 0.001 ? '< 0,001' : fmt(p, 3));

function TrendIcon({ slope }: { slope: number }) {
  if (Math.abs(slope) < 0.05) return <Minus className="w-4 h-4 text-muted" aria-label="estable" />;
  return slope > 0
    ? <TrendingUp className="w-4 h-4 text-ink-2" aria-label="sube" />
    : <TrendingDown className="w-4 h-4 text-ink-2" aria-label="baja" />;
}

/** Veredicto de Mann-Kendall: el rojo reservado solo marca lo significativo. */
function Verdict({ trend }: { trend: Trend }) {
  return trend.significant ? (
    <span className="inline-flex items-center gap-1 text-signal font-bold">
      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Significativa
    </span>
  ) : (
    <span className="text-muted">No significativa</span>
  );
}

export default function TimeSeriesPanel({ sessionId, sceneYear, zoneName, series, onSeries, onSelectYear }: TimeSeriesPanelProps) {
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

  // Años excluidos de la tendencia: hueco en los gráficos
  const used = new Set(series?.years_used_for_trend ?? []);
  const defs = series?.classes ?? RULES_DEFS;
  const main = defs[0];
  const data = series?.points.map(p => {
    const ok = used.has(p.year);
    return {
      year: p.year,
      ...Object.fromEntries(defs.map(d => [d.key, ok ? p.stats[d.key]?.percent_clear ?? null : null])),
      ndvi: ok ? p.ndvi_mean : null,
    };
  }) ?? [];

  const veg = series?.trends[main.key];
  const span = series ? `${series.points[0]?.year}–${series.points[series.points.length - 1]?.year}` : '';

  return (
    <div className="space-y-6">
      <section className="sheet p-4 flex flex-wrap items-end justify-between gap-3" aria-labelledby="series-title">
        <div className="max-w-[60ch]">
          <h2 id="series-title" className="font-serif text-xl font-semibold">
            Serie <span className="figure">{sceneYear - 10}–{sceneYear}</span>
          </h2>
          <p className="text-sm text-ink-2 mt-1">
            Procesa los 10 años anteriores en paralelo (misma temporada, la escena más despejada de cada año)
            y estima la tendencia con Theil-Sen y su significancia con Mann-Kendall. Tarda cerca de un minuto.
          </p>
        </div>
        <button onClick={run} disabled={status === 'running'} className="btn btn-primary">
          {status === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {series ? 'Recalcular serie' : 'Calcular la serie'}
        </button>
      </section>

      {(status === 'running' || status === 'error') && (
        <TaskProgress
          status={status}
          progress={progress}
          lines={logs}
          error={errorMsg}
          titles={{ running: 'Descargando y clasificando años anteriores…', done: 'Serie lista', error: 'No se pudo calcular la serie' }}
        />
      )}

      {series && status !== 'running' && (
        <div className="space-y-6 animate-fade-in">
          {veg && (
            <p className="text-lg max-w-[70ch] leading-relaxed">
              Entre <span className="figure">{span}</span> {phrase(main)} cambió{' '}
              <span className={`figure font-bold ${veg.significant && veg.slope < 0 ? 'text-signal' : ''}`}>
                {veg.slope > 0 ? '+' : ''}{fmt(veg.ha_per_year, 1)} ha por año
              </span>{' '}
              (IC 95 % <span className="figure">{fmt(veg.ha_per_year_low, 1)}</span> a <span className="figure">{fmt(veg.ha_per_year_high, 1)}</span>).{' '}
              {veg.significant
                ? <>Es una tendencia <b>estadísticamente significativa</b> (p = <span className="figure">{fmtP(veg.p_value)}</span>).</>
                : <>No es estadísticamente significativa (p = <span className="figure">{fmtP(veg.p_value)}</span>): puede deberse al azar.</>}
            </p>
          )}

          <a
            href={`${API_BASE}/export/trend.png?session_id=${sessionId}&title=${encodeURIComponent(`Vegetación en ${zoneName}`)}`}
            download
            className="btn btn-primary"
          >
            <ImageIcon className="w-4 h-4" />
            Gráfico de tendencia para publicar
          </a>

          <div className="sheet overflow-x-auto">
            <table className="data-table">
              <caption className="sr-only">Tendencias por clase</caption>
              <thead>
                <tr>
                  <th scope="col">Clase</th>
                  <th scope="col" className="!text-right">Tendencia</th>
                  <th scope="col" className="!text-right">IC 95 %</th>
                  <th scope="col" className="!text-right">τ</th>
                  <th scope="col" className="!text-right">p</th>
                  <th scope="col">Mann-Kendall</th>
                </tr>
              </thead>
              <tbody>
                {defs.map(d => {
                  const k = d.key;
                  const t = series.trends[k];
                  return (
                    <tr key={k}>
                      <td>
                        <span className="flex items-center gap-2 font-semibold">
                          <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: d.color }} aria-hidden />
                          {d.label}
                        </span>
                      </td>
                      {t ? (
                        <>
                          <td className="num">
                            <span className="inline-flex items-center gap-1.5 justify-end">
                              <TrendIcon slope={t.slope} />
                              {t.slope > 0 ? '+' : ''}{fmt(t.ha_per_year, 1)} ha/año
                            </span>
                          </td>
                          <td className="num text-ink-2">[{fmt(t.ha_per_year_low, 1)}; {fmt(t.ha_per_year_high, 1)}]</td>
                          <td className="num">{fmt(t.tau, 2)}</td>
                          <td className="num">{fmtP(t.p_value)}</td>
                          <td><Verdict trend={t} /></td>
                        </>
                      ) : (
                        <td colSpan={5} className="text-muted">Años insuficientes</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <figure className="sheet p-4">
            <figcaption>
              <span className="block font-semibold">Cobertura por clase</span>
              <span className="block text-sm text-muted mb-3">% del área sin nubes en cada escena</span>
            </figcaption>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="year" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#aab3a6' }} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} unit=" %" domain={[0, 100]} />
                <Tooltip {...TOOLTIP_PROPS} formatter={(v, name) => [`${fmt(Number(v), 1)} %`, name]} />
                <Legend wrapperStyle={{ fontSize: 13 }} iconType="plainline" formatter={v => <span style={{ color: '#3d4856' }}>{v}</span>} />
                {defs.map(d => (
                  <Line
                    key={d.key}
                    dataKey={d.key}
                    name={d.label}
                    stroke={chartColor(d)}
                    strokeWidth={2}
                    dot={{ r: 4, strokeWidth: 2, stroke: DOT_RING, fill: chartColor(d) }}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: DOT_RING }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </figure>

          <figure className="sheet p-4">
            <figcaption>
              <span className="block font-semibold">NDVI medio de la zona</span>
              <span className="block text-sm text-muted mb-3">
                {series.ndvi_trend
                  ? <>Theil-Sen <span className="figure">{series.ndvi_trend.slope > 0 ? '+' : ''}{fmt(series.ndvi_trend.slope, 4)}</span> por año · p <span className="figure">{fmtP(series.ndvi_trend.p_value)}</span> ({series.ndvi_trend.significant ? 'significativa' : 'no significativa'})</>
                  : 'Píxeles sin nubes'}
              </span>
            </figcaption>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="year" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#aab3a6' }} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} domain={['auto', 'auto']} tickFormatter={v => fmt(Number(v), 2)} />
                <Tooltip {...TOOLTIP_PROPS} formatter={v => [fmt(Number(v), 3), 'NDVI medio']} />
                <Line
                  dataKey="ndvi"
                  stroke={chartColor(main)}
                  strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, stroke: DOT_RING, fill: chartColor(main) }}
                  activeDot={{ r: 6, strokeWidth: 2, stroke: DOT_RING }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </figure>

          <section className="sheet overflow-x-auto" aria-labelledby="detail-title">
            <h3 id="detail-title" className="px-4 pt-3 font-semibold">Detalle por año</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Año</th>
                  <th scope="col">Escena</th>
                  <th scope="col" className="!text-right">Clasificado</th>
                  {defs.map(d => (
                    <th key={d.key} scope="col" className="!text-right">{d.label}</th>
                  ))}
                  <th scope="col" className="!text-right">NDVI</th>
                  <th scope="col"><span className="sr-only">Acción</span></th>
                </tr>
              </thead>
              <tbody>
                {series.points.map(p => {
                  const lowClear = p.valid_percent < series.min_valid_percent;
                  return (
                    <tr key={p.year}>
                      <td className="figure font-bold">{p.year}</td>
                      <td className="figure text-ink-2">{p.scene.datetime.slice(0, 10)}</td>
                      <td className={`num ${lowClear ? 'text-soil font-bold' : ''}`} title={lowClear ? 'Menos del 50 % clasificado: excluido de la tendencia' : undefined}>
                        {fmt(p.valid_percent, 0)} %
                      </td>
                      {defs.map(d => (
                        <td key={d.key} className="num">{fmt(p.stats[d.key]?.percent_clear, 1)} %</td>
                      ))}
                      <td className="num">{fmt(p.ndvi_mean, 3)}</td>
                      <td className="text-right">
                        {p.year !== sceneYear && (
                          <button onClick={() => onSelectYear(p.year)} className="inline-flex items-center gap-1 text-sm font-bold text-stamp-2 hover:underline">
                            Comparar <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-rule space-y-1 text-sm">
              {series.failed.map(f => (
                <p key={f.year} className="flex items-start gap-2 text-ink-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-soil" aria-hidden /> {f.error}
                </p>
              ))}
              <p className="text-muted">
                Tendencias con <span className="figure">{series.years_used_for_trend.length}</span> años (≥ 50 % de la zona clasificada; los demás no cuentan).
                Superficie analizada: <span className="figure">{fmt(series.total_hectares, 0)}</span> ha.
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
