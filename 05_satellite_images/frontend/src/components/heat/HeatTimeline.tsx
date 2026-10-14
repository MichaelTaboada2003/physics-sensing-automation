import { useEffect, useId, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { HeatTimeSeries, StreamLine } from '../../types';
import { useProgressStream } from '../../hooks/useProgressStream';
import { fmtC, fmtDate, signedC } from '../../lib/heat';
import TaskProgress, { type TaskStatus } from '../TaskProgress';

interface HeatTimelineProps { sessionId: string; configurable?: boolean }

const fmtArea = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: n < 10 ? 2 : 0 });

/** Observaciones brutas y cobertura en dos ejes temporales alineados, no dos escalas superpuestas. */
export default function HeatTimeline({ sessionId, configurable = false }: HeatTimelineProps) {
  const id = useId();
  const [yearsBack, setYearsBack] = useState(10);
  const [series, setSeries] = useState<HeatTimeSeries | null>(null);
  const [changes, setChanges] = useState(true);
  const [status, setStatus] = useState<TaskStatus>('idle');
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { consume } = useProgressStream();
  const query = `session_id=${encodeURIComponent(sessionId)}&years_back=${yearsBack}`;

  useEffect(() => {
    let alive = true;
    fetch(`/heat/timeseries/summary?${query}`)
      .then(r => r.ok ? r.json() : null)
      .then((s: HeatTimeSeries | null) => { if (alive) setSeries(s); })
      .catch(() => { if (alive) setSeries(null); });
    return () => { alive = false; };
  }, [query]);

  const run = async () => {
    setStatus('running'); setLines([]); setError(null); setSeries(null);
    await consume('/heat/timeseries', 'POST', JSON.stringify({ session_id: sessionId, years_back: yearsBack }),
      l => setLines(prev => [...prev, l]),
      l => {
        if (l.heat_series) { setSeries(l.heat_series); setStatus('done'); }
        else { setStatus('error'); setError('El servidor no devolvió la serie. Vuelve a intentarlo.'); }
      },
      l => { setStatus('error'); setError(l.error ?? l.message); },
    );
  };

  const ready = series?.points.filter(p => p.temperature_mean !== null) ?? [];
  const first = ready[0];
  const last = ready[ready.length - 1];
  const missing = series?.points.filter(p => p.reason) ?? [];
  const label = series?.coverage_label.toLowerCase() ?? 'cobertura';
  const temperatureKey = changes ? 'temperature_change' : 'temperature_mean';
  const coverKey = changes ? 'loss_hectares' : 'cover_hectares';

  return (
    <section className="space-y-5" aria-labelledby={`${id}-title`}>
      <div className="max-w-[75ch] space-y-2">
        <h2 id={`${id}-title`} className="font-serif text-2xl font-semibold">Temperatura y pérdida de cobertura</h2>
        <p className="text-ink-2">
          Compara cómo cambia la temperatura de la superficie con la cobertura del lugar. Son observaciones sin descontar
          el calentamiento de otras zonas: la aplicación no atribuye una causa ni saca una conclusión por ti.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {configurable && (
          <label className="text-sm font-semibold space-y-1">
            <span className="block">Periodo</span>
            <select className="field !min-h-11" value={yearsBack} disabled={status === 'running'}
              onChange={e => { setSeries(null); setStatus('idle'); setYearsBack(Number(e.target.value)); }}>
              {[3, 5, 10].map(y => <option key={y} value={y}>{y} años anteriores + referencia</option>)}
            </select>
          </label>
        )}
        <button className="btn btn-primary" disabled={status === 'running'} onClick={run}>
          {status === 'running' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <RefreshCw className="w-4 h-4" aria-hidden />}
          {status === 'running' ? 'Calculando observaciones…' : ready.length ? 'Completar / reintentar años faltantes' : 'Calcular serie de temperatura y cobertura'}
        </button>
        <p className="text-sm text-muted max-w-[45ch]">A demanda. Reutiliza lo calculado; cada año nuevo puede tardar alrededor de 30 s.</p>
      </div>

      <TaskProgress status={status} progress={lines.at(-1)?.progress ?? 0} lines={lines} error={error}
        titles={{ running: 'Consultando Landsat y cobertura…', done: 'Observaciones revisadas', error: 'No se pudo completar la serie' }} />

      {series && !series.enough && (
        <p className="sheet p-4 text-ink-2" role="status">
          Para comparar se necesitan al menos dos años y un área común válida de {series.min_common_percent} % o más.
          {series.common_percent > 0 && <> Área común disponible: <span className="figure">{series.common_percent.toLocaleString('es-CO')} %</span>.</>}
          {' '}Los datos faltantes se mantienen como huecos, nunca como cero.
        </p>
      )}

      {series?.enough && first && last && (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="sheet p-4">
              <dt className="text-sm text-ink-2">Temperatura observada · {first.year} → {last.year}</dt>
              <dd className="figure font-bold text-lg mt-1">{fmtC(first.temperature_mean!)} → {fmtC(last.temperature_mean!)}</dd>
              <dd className="figure text-sm mt-1">Cambio: {signedC(last.temperature_change!)}</dd>
            </div>
            <div className="sheet p-4">
              <dt className="text-sm text-ink-2">Pérdida de {label} desde {series.reference_year}</dt>
              <dd className="figure font-bold text-lg mt-1">{last.loss_hectares === null ? 'No evaluada' : `${fmtArea(last.loss_hectares)} ha`}</dd>
              <dd className="text-sm text-muted mt-1">Pérdida bruta respecto a la base, no balance neto ni suma anual.</dd>
            </div>
            <div className="sheet p-4">
              <dt className="text-sm text-ink-2">Misma superficie en todas las observaciones</dt>
              <dd className="figure font-bold text-lg mt-1">{fmtArea(series.common_hectares)} ha · {series.common_percent.toLocaleString('es-CO')} %</dd>
              <dd className="text-sm text-muted mt-1">Sin extrapolar al resto de la zona.</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-3 items-center">
            <div className="segmented" role="group" aria-label="Valores del gráfico">
              <button className="!min-h-11" type="button" aria-pressed={changes} onClick={() => setChanges(true)}>Cambios desde {series.reference_year}</button>
              <button className="!min-h-11" type="button" aria-pressed={!changes} onClick={() => setChanges(false)}>Valores observados</button>
            </div>
            <a href={`/heat/timeseries.csv?${query}`} download className="btn btn-secondary">
              <Download className="w-4 h-4" aria-hidden /> Descargar datos (CSV)
            </a>
          </div>

          <div className="sheet p-3 sm:p-4 space-y-5" role="group" aria-label="Gráficos temporales alineados">
            {[
              { key: temperatureKey, title: changes ? 'Cambio observado de temperatura (°C)' : 'Temperatura media de la superficie (°C)', color: '#b45309', thermal: true },
              { key: coverKey, title: changes ? `Pérdida de ${label} desde ${series.reference_year} (ha)` : `${series.coverage_label} estimada (ha)`, color: '#14532d', thermal: false },
            ].map(chart => (
              <figure key={chart.key}>
                <figcaption className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <span className="w-5 h-0.5 inline-block" style={{ background: chart.color }} aria-hidden /> {chart.title}
                </figcaption>
                {!chart.thermal && !series.primary_learned ? <p className="text-sm text-ink-2 py-6">El modelo no aprendió esta cobertura. No se muestra como 0 ha.</p> : (
                  <ResponsiveContainer width="100%" height={230}>
                    <LineChart data={series.points} syncId={id} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="#cdd3c8" vertical={false} />
                      <XAxis dataKey="year" type="number" domain={['dataMin', 'dataMax']} allowDecimals={false}
                        ticks={series.points.map(p => p.year)} minTickGap={20} tick={{ fontSize: 12 }} />
                      <YAxis width={56} domain={chart.thermal ? ['auto', 'auto'] : [0, 'auto']} tick={{ fontSize: 12 }}
                        tickFormatter={v => Number(v).toLocaleString('es-CO', { maximumFractionDigits: chart.thermal ? 1 : 0 })} />
                      {changes && <ReferenceLine y={0} stroke="#5f6b77" strokeDasharray="3 3" />}
                      <Tooltip content={({ active, label: year }) => {
                        const p = series.points.find(p => p.year === Number(year));
                        if (!active || !p) return null;
                        return <div className="sheet p-3 text-sm max-w-[260px] space-y-1">
                          <p className="font-bold figure">Referencia {p.year}</p>
                          <p>{p.temperature_mean === null ? 'Sin temperatura comparable' : `${fmtC(p.temperature_mean)} · Δ ${signedC(p.temperature_change!)}`}</p>
                          <p>{p.loss_hectares === null ? 'Cobertura no evaluada' : `${fmtArea(p.cover_hectares!)} ha · pérdida ${fmtArea(p.loss_hectares)} ha`}</p>
                          {p.heat_scene && <p className="text-muted">Landsat: {fmtDate(p.heat_scene.datetime)}</p>}
                          {p.cover_scene && <p className="text-muted">Cobertura: {fmtDate(p.cover_scene.datetime)}</p>}
                          {p.reason && <p>{p.reason}</p>}
                        </div>;
                      }} />
                      <Line dataKey={chart.key} type="linear" stroke={chart.color} strokeWidth={2.5} dot={{ r: 3 }}
                        connectNulls={false} isAnimationActive={false} name={chart.title} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </figure>
            ))}
            <p className="text-sm text-muted">Mismo eje temporal, unidades distintas. La cercanía visual de las líneas no mide correlación ni demuestra causalidad.</p>
          </div>
        </>
      )}

      {series && (
        <details className="sheet p-4">
          <summary className="font-semibold cursor-pointer">Ver tabla, fechas y años sin datos ({series.points.length})</summary>
          <div className="overflow-x-auto mt-3">
            <table className="data-table">
              <caption className="sr-only">Temperatura observada y cobertura sobre soporte espacial común</caption>
              <thead><tr>
                <th scope="col">Año de referencia</th><th scope="col">Fecha Landsat</th><th scope="col">Fecha cobertura</th>
                <th scope="col">Temperatura (°C)</th><th scope="col">Δ temperatura</th><th scope="col">Cobertura (ha)</th>
                <th scope="col">Pérdida desde base (ha)</th><th scope="col">Disponible por año</th><th scope="col">Estado</th>
              </tr></thead>
              <tbody>{series.points.map(p => <tr key={p.year}>
                <th scope="row" className="figure">{p.year}</th>
                <td className="whitespace-nowrap">{p.heat_scene ? fmtDate(p.heat_scene.datetime) : '—'}</td>
                <td className="whitespace-nowrap">{p.cover_scene ? fmtDate(p.cover_scene.datetime) : '—'}</td>
                <td className="num">{p.temperature_mean === null ? '—' : fmtC(p.temperature_mean)}</td>
                <td className="num">{p.temperature_change === null ? '—' : signedC(p.temperature_change)}</td>
                <td className="num">{p.cover_hectares === null ? '—' : fmtArea(p.cover_hectares)}</td>
                <td className="num">{p.loss_hectares === null ? '—' : fmtArea(p.loss_hectares)}</td>
                <td className="num">{p.available_percent.toLocaleString('es-CO')} %</td>
                <td>{p.reason ?? 'Comparable'}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
      {missing.length > 0 && <p className="text-sm text-ink-2">Años sin observación comparable: {missing.map(p => p.year).join(', ')}. Puedes reintentarlos; no se interpolan.</p>}
      <ul className="text-sm text-ink-2 list-disc pl-5 space-y-1.5 max-w-[85ch]">
        <li>Una escena Landsat por año de referencia, buscada en la misma temporada (±60 días; puede recurrir a otro mes y cruzar de año). Las fechas reales están en la tabla.</li>
        <li>La temperatura de superficie no es temperatura del aire ni promedio anual. El cambio entre escenas también refleja el tiempo de cada día; no es por sí solo una tendencia climática.</li>
        <li>Si el modelo usa WorldCover, la cobertura arbórea incluye plantaciones: su pérdida clasificada no confirma por sí sola deforestación de bosque natural. Si usa reglas, solo mide vegetación.</li>
        <li>Todos los años graficados usan los mismos píxeles con temperatura y clasificación válidas. La pérdida bruta cuenta dónde había esa cobertura en la base y ya no la hay; puede coexistir con ganancias en otros píxeles. No es el balance neto ni la suma de pérdidas anuales.</li>
        <li>Datos Landsat 8/9 (USGS) y Sentinel-2 (Copernicus); etiquetas ESA WorldCover 2021 cuando corresponda.</li>
      </ul>
    </section>
  );
}
