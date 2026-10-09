import { useCallback, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertCircle, ArrowRight, Check, Circle, Download, FileSpreadsheet, FileText,
  Image as ImageIcon, Info, Loader2, RotateCcw, Telescope,
} from 'lucide-react';
import type { BBox, LayerKind, ScenesResponse, SearchResponse, StreamLine, TimeSeries, Zone } from '../types';
import { useProgressStream } from '../hooks/useProgressStream';
import { useLayerBounds } from '../hooks/useLayerBounds';
import { useMapStats } from '../hooks/useMapStats';
import { PRESETS, bboxIsTooLarge, bboxInRegion } from '../lib/geo';
import { useRegion } from '../hooks/useRegion';
import { DEFAULT_THRESHOLDS } from '../lib/classifier';
import AoiMap from './map/AoiMap';
import SwipeMap from './map/SwipeMap';
import MapLegend from './MapLegend';
import SpecimenLabel from './SpecimenLabel';
import type { DeterminationSlip } from './SpecimenLabel';

// ── Tipos y constantes ─────────────────────────────────────────────────────────

export type GuidedStage = 'zone' | 'running' | 'results';

type TaskId = 'scene' | 'bands' | 'train' | 'map' | 'series';

const TASKS: { id: TaskId; label: string; detail: string }[] = [
  { id: 'scene', label: 'Buscar la imagen más despejada', detail: 'Entre las imágenes del último año, la que tiene menos nubes sobre la zona.' },
  { id: 'bands', label: 'Descargar la imagen', detail: 'Nueve bandas de luz, de lo visible al infrarrojo, y la máscara de nubes.' },
  { id: 'train', label: 'Aprender a reconocer la cobertura', detail: 'Vegetación, agua y suelo expuesto, a partir de reglas espectrales.' },
  { id: 'map', label: 'Clasificar la zona', detail: 'Cada píxel de 10 × 10 m recibe una clase.' },
  { id: 'series', label: 'Revisar los 10 años anteriores', detail: 'La misma temporada de cada año, clasificada con el mismo modelo.' },
];

const LAST_YEAR = new Date().getFullYear() - 1;
const API_BASE = '';

interface GuidedFlowProps {
  stage: GuidedStage;
  onStage: (s: GuidedStage) => void;
  /** Registra la sesión en la app (el modo experto la reutiliza). */
  onSession: (response: SearchResponse, zone: Zone) => void;
  onMapReady: () => void;
  onOpenExpert: () => void;
  sessionId: string | null;
  zone: Zone | null;
  sceneInfo: { id: string; datetime: string } | null;
}

const fmt = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: d });

// ── Componente ─────────────────────────────────────────────────────────────────

export default function GuidedFlow({
  stage, onStage, onSession, onMapReady, onOpenExpert, sessionId, zone, sceneInfo,
}: GuidedFlowProps) {
  const region = useRegion();
  const { consume } = useProgressStream();

  // Zona
  const [bbox, setBbox] = useState<BBox>(PRESETS[0].bbox);
  const [zoneName, setZoneName] = useState(PRESETS[0].name);
  const [focus, setFocus] = useState<{ bbox: BBox; n: number } | undefined>();

  // Ejecución
  const [current, setCurrent] = useState<TaskId | null>(null);
  const [done, setDone] = useState<TaskId[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<{ task: TaskId; text: string } | null>(null);
  const [series, setSeries] = useState<TimeSeries | null>(null);

  const zoneError =
    region && !bboxInRegion(bbox, region) ? 'La zona debe estar en Colombia.'
    : bboxIsTooLarge(bbox) ? 'La zona es demasiado grande: dibuja una más pequeña (máximo 500 km²).'
    : null;

  /** Envuelve un stream NDJSON en una promesa que resuelve con la línea final. */
  const stream = useCallback((url: string, body: object) =>
    new Promise<StreamLine>((resolve, reject) => {
      consume(
        url, 'POST', JSON.stringify(body),
        l => setMessage(l.message),
        l => resolve(l),
        l => reject(new Error(l.error ?? l.message)),
      );
    }), [consume]);

  const run = async () => {
    onStage('running');
    setDone([]);
    setError(null);
    setSeries(null);
    const zoneNow: Zone = { name: zoneName, bbox };
    let task: TaskId = 'scene';
    const finish = (t: TaskId) => setDone(d => [...d, t]);
    try {
      // 1. Escena más despejada del último año
      setCurrent(task);
      setMessage('Midiendo nubes sobre la zona…');
      const query = { bbox, time_range: `${LAST_YEAR}-01-01/${LAST_YEAR}-12-31`, cloud_cover_threshold: 60 };
      const scenesRes = await fetch(`${API_BASE}/scenes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
      });
      if (!scenesRes.ok) throw new Error(scenesRes.status === 404
        ? `No hay imágenes de ${LAST_YEAR} con pocas nubes para esta zona. Prueba otra zona.`
        : 'El catálogo de imágenes no respondió. Inténtalo de nuevo en un momento.');
      const scenes: ScenesResponse = await scenesRes.json();
      const searchRes = await fetch(`${API_BASE}/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...query, search_id: scenes.search_id, scene_id: scenes.scenes[0].id }),
      });
      if (!searchRes.ok) throw new Error('No se pudo abrir la imagen elegida. Inténtalo de nuevo.');
      const session: SearchResponse = await searchRes.json();
      onSession(session, zoneNow);
      finish(task);

      // 2–4. Bandas, modelo y mapa
      task = 'bands'; setCurrent(task);
      await stream(`${API_BASE}/download`, { session_id: session.session_id });
      finish(task);
      task = 'train'; setCurrent(task);
      await stream(`${API_BASE}/train`, { session_id: session.session_id, ...DEFAULT_THRESHOLDS });
      finish(task);
      task = 'map'; setCurrent(task);
      await stream(`${API_BASE}/predict`, { session_id: session.session_id });
      onMapReady();
      finish(task);

      // 5. Serie de 10 años
      task = 'series'; setCurrent(task);
      const last = await stream(`${API_BASE}/timeseries`, { session_id: session.session_id, years_back: 10 });
      if (last.series) setSeries(last.series);
      finish(task);
      setCurrent(null);
      onStage('results');
    } catch (e) {
      setError({ task, text: e instanceof Error ? e.message : 'Error inesperado.' });
      setCurrent(null);
    }
  };

  // ── Etapa 1: zona ──────────────────────────────────────────────────────────
  if (stage === 'zone') {
    return (
      <div key="zone" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] items-start animate-fade-in pb-20 lg:pb-0">
        <AoiMap bbox={bbox} onChange={b => { setBbox(b); setZoneName('Zona personalizada'); }} focus={focus}>
          <div className="hidden sm:block"><SpecimenLabel zone={{ name: zoneName, bbox }} /></div>
        </AoiMap>
        <div className="space-y-5">
          <fieldset>
            <legend className="field-label mb-2">Elige un lugar o dibuja tu zona en el mapa</legend>
            <ul className="sheet divide-y divide-rule overflow-hidden">
              {PRESETS.map(p => (
                <li key={p.name}>
                  <button
                    type="button"
                    aria-pressed={zoneName === p.name}
                    onClick={() => { setBbox(p.bbox); setZoneName(p.name); setFocus(f => ({ bbox: p.bbox, n: (f?.n ?? 0) + 1 })); }}
                    className={`w-full text-left px-3.5 py-2.5 transition-colors ${zoneName === p.name ? 'bg-stamp-tint' : 'hover:bg-paper-2'}`}
                  >
                    <span className={`block font-semibold ${zoneName === p.name ? 'text-stamp-2' : ''}`}>{p.name}</span>
                    <span className="block text-sm text-muted">{p.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
          {zoneError && <p role="alert" className="text-sm text-signal font-semibold">{zoneError}</p>}
          {/* En el móvil la acción queda fija abajo, sin desplazarse por el mapa y la lista */}
          <div className="fixed left-4 right-4 bottom-4 z-[1100] lg:static">
            <button onClick={run} disabled={!!zoneError} className="btn btn-primary w-full shadow-[var(--shadow-lift)] lg:shadow-none">
              <Telescope className="w-4 h-4" />
              Analizar {zoneName === 'Zona personalizada' ? 'esta zona' : zoneName.split(',')[0]}: últimos 10 años
            </button>
          </div>
          <p className="text-sm text-muted">Tarda alrededor de un minuto. Usamos imágenes gratuitas del satélite Sentinel-2.</p>
        </div>
      </div>
    );
  }

  // ── Etapa 2: análisis ──────────────────────────────────────────────────────
  if (stage === 'running') {
    return (
      <div key="running" className="max-w-2xl space-y-5 animate-fade-in">
        <ol className="sheet divide-y divide-rule" aria-live="polite">
          {TASKS.map(t => {
            const isDone = done.includes(t.id);
            const isCurrent = current === t.id;
            const failed = error?.task === t.id;
            return (
              <li key={t.id} className="flex gap-3 px-4 py-3">
                <span className="mt-0.5 shrink-0">
                  {failed ? <AlertCircle className="w-5 h-5 text-signal" aria-label="falló" />
                    : isDone ? <Check className="w-5 h-5 text-veg" strokeWidth={3} aria-label="listo" />
                    : isCurrent ? <Loader2 className="w-5 h-5 text-stamp animate-spin" aria-label="en curso" />
                    : <Circle className="w-5 h-5 text-rule-strong" aria-label="pendiente" />}
                </span>
                <span className="min-w-0">
                  <span className={`block font-semibold ${!isDone && !isCurrent && !failed ? 'text-muted' : ''}`}>{t.label}</span>
                  <span className="block text-sm text-ink-2">{isCurrent && message ? message : t.detail}</span>
                  {failed && <span className="block text-sm text-signal mt-1">{error.text}</span>}
                </span>
              </li>
            );
          })}
        </ol>
        {error && (
          <div className="flex flex-wrap gap-3">
            <button onClick={run} className="btn btn-primary"><RotateCcw className="w-4 h-4" /> Reintentar</button>
            <button onClick={() => onStage('zone')} className="btn btn-secondary">Elegir otra zona</button>
          </div>
        )}
      </div>
    );
  }

  // ── Etapa 3: resultados ────────────────────────────────────────────────────
  return sessionId && zone ? (
    <GuidedResults
      sessionId={sessionId}
      zone={zone}
      sceneInfo={sceneInfo}
      series={series}
      onRestart={() => onStage('zone')}
      onOpenExpert={onOpenExpert}
    />
  ) : null;
}

// ── Resultados ─────────────────────────────────────────────────────────────────

function GuidedResults({
  sessionId, zone, sceneInfo, series, onRestart, onOpenExpert,
}: {
  sessionId: string;
  zone: Zone;
  sceneInfo: { id: string; datetime: string } | null;
  series: TimeSeries | null;
  onRestart: () => void;
  onOpenExpert: () => void;
}) {
  const [layer, setLayer] = useState<LayerKind>('rgb');
  const { bounds } = useLayerBounds(sessionId);
  const stats = useMapStats(sessionId, 'guided');

  if (!series) {
    return <p className="text-ink-2">No hay serie temporal para esta zona. <button className="underline" onClick={onRestart}>Elegir otra zona</button></p>;
  }

  const current = series.points[series.points.length - 1];
  const used = new Set(series.years_used_for_trend);
  // Año base: el primero bien clasificado desde 2017 (antes, Sentinel-2 L2A es irregular)
  const candidates = series.points.filter(p => used.has(p.year) && p.year !== current.year);
  const base = candidates.find(p => p.year >= 2017) ?? candidates[0] ?? series.points[0];
  const veg = series.trends.vegetation;
  const total = series.total_hectares;
  // Años sin suficientes píxeles clasificados: hueco en el gráfico, nunca 0
  const chart = series.points.map(p => ({
    year: p.year,
    ha: used.has(p.year) && p.stats.vegetation.percent_clear !== null
      ? Math.round((p.stats.vegetation.percent_clear / 100) * total)
      : null,
  }));
  const skipped = series.points.filter(p => !used.has(p.year)).map(p => p.year);
  const others = (['water', 'mining'] as const)
    .map(k => ({ k, t: series.trends[k] }))
    .filter(o => o.t?.significant);
  const OTHER_LABEL = { water: 'el agua', mining: 'el suelo expuesto o minería' } as const;
  const slips: DeterminationSlip[] = series.points.filter(p => p.year !== current.year).map(p => ({
    year: p.year,
    date: p.scene.datetime.slice(0, 10),
    vegetation: p.stats.vegetation.percent_clear,
    water: p.stats.water.percent_clear,
    mining: p.stats.mining.percent_clear,
  }));
  const title = encodeURIComponent(zone.name);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Titular */}
      <section className="max-w-[72ch]">
        {veg ? (
          <p className="font-serif text-[1.5rem] sm:text-[1.75rem] leading-snug">
            En {zone.name}, la vegetación{' '}
            {veg.slope < 0 ? 'se redujo' : veg.slope > 0 ? 'aumentó' : 'se mantuvo'}{' '}
            <b className={veg.significant && veg.slope < 0 ? 'text-signal' : ''}>
              <span className="figure">{fmt(Math.abs(veg.ha_per_year ?? 0), 0)}</span> hectáreas por año
            </b>{' '}
            entre <span className="figure">{series.years_used_for_trend[0]}</span> y <span className="figure">{current.year}</span>.
          </p>
        ) : (
          <p className="font-serif text-2xl">No hay suficientes años despejados para estimar una tendencia en {zone.name}.</p>
        )}
        {veg && (
          <p className="mt-3 text-ink-2">
            {veg.significant
              ? <>La tendencia es <b className="text-ink">estadísticamente significativa</b> (Mann-Kendall p = <span className="figure">{fmt(veg.p_value, 3)}</span>): es poco probable que se deba al azar.</>
              : <>La tendencia <b className="text-ink">no es estadísticamente significativa</b> (p = <span className="figure">{fmt(veg.p_value, 3)}</span>): con estos datos no se puede afirmar que haya un cambio sostenido.</>}{' '}
            Con un 95 % de confianza, el cambio anual está entre <span className="figure">{fmt(veg.ha_per_year_low, 0)}</span> y{' '}
            <span className="figure">{fmt(veg.ha_per_year_high, 0)}</span> ha.
          </p>
        )}
        {others.length > 0 && (
          <p className="mt-2 text-ink-2">
            También cambió de forma significativa{' '}
            {others.map((o, i) => (
              <span key={o.k}>
                {i > 0 && ' y '}
                {OTHER_LABEL[o.k]} (<span className="figure">{o.t!.slope > 0 ? '+' : '−'}{fmt(Math.abs(o.t!.ha_per_year ?? 0), 0)}</span> ha/año)
              </span>
            ))}.
          </p>
        )}
      </section>

      {/* Antes / después */}
      <section className="sheet overflow-hidden" aria-label="Antes y después">
        <div className="p-3 border-b border-rule bg-paper-2 flex flex-wrap items-center gap-3">
          <div className="segmented" role="group" aria-label="Capa">
            <button aria-pressed={layer === 'rgb'} onClick={() => setLayer('rgb')}>Imagen</button>
            <button aria-pressed={layer === 'class'} onClick={() => setLayer('class')}>Clasificación</button>
            <button aria-pressed={layer === 'change'} onClick={() => setLayer('change')}>Cambios</button>
          </div>
          <MapLegend kind={layer} />
        </div>
        {bounds && (layer === 'change' ? (
          <SwipeMap
            bounds={bounds}
            after={{ url: `${API_BASE}/layer?session_id=${sessionId}&kind=change&year=${base.year}`, label: 'Cambios' }}
            opacity={0.9}
            height="h-[440px] lg:h-[580px]"
          >
            <div className="hidden sm:block">
              <SpecimenLabel zone={zone} scene={sceneInfo} cloudFraction={stats?.cloud_fraction} classes={stats?.classes} slips={slips} vegetationTrend={veg} defaultCollapsed />
            </div>
          </SwipeMap>
        ) : (
          <SwipeMap
            bounds={bounds}
            before={{ url: `${API_BASE}/layer?session_id=${sessionId}&kind=${layer}&year=${base.year}`, label: String(base.year) }}
            after={{ url: `${API_BASE}/layer?session_id=${sessionId}&kind=${layer}`, label: String(current.year) }}
            opacity={1}
            height="h-[440px] lg:h-[580px]"
          >
            <div className="hidden sm:block">
              <SpecimenLabel zone={zone} scene={sceneInfo} cloudFraction={stats?.cloud_fraction} classes={stats?.classes} slips={slips} vegetationTrend={veg} defaultCollapsed />
            </div>
          </SwipeMap>
        ))}
        <p className="px-4 py-2.5 border-t border-rule text-sm text-ink-2">
          Arrastra el divisor: a la izquierda <span className="figure">{base.year}</span>, a la derecha <span className="figure">{current.year}</span>.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        {/* Evolución */}
        <figure className="sheet p-4">
          <figcaption className="mb-3">
            <span className="block font-semibold">Hectáreas de vegetación por año</span>
            <span className="block text-sm text-muted">
              Estimadas sobre el área sin nubes · eje desde cero
              {skipped.length > 0 && <> · sin datos suficientes: <span className="figure">{skipped.join(', ')}</span></>}
            </span>
          </figcaption>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="#e1e5dc" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: '#3d4856', fontSize: 12, fontFamily: 'Courier Prime, monospace' }} tickLine={false} axisLine={{ stroke: '#aab3a6' }} />
              <YAxis domain={[0, 'auto']} tick={{ fill: '#3d4856', fontSize: 12, fontFamily: 'Courier Prime, monospace' }} tickLine={false} axisLine={false} tickFormatter={v => Number(v).toLocaleString('es-CO')} width={56} />
              <Tooltip
                contentStyle={{ background: '#fbfcf8', border: '1px solid #cdd3c8', borderRadius: 4, fontSize: 13 }}
                formatter={v => [`${Number(v).toLocaleString('es-CO')} ha`, 'Vegetación']}
              />
              <Line dataKey="ha" stroke="#16a34a" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: '#fbfcf8', fill: '#16a34a' }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </figure>

        {/* Para publicar */}
        <section className="space-y-3" aria-labelledby="publish-title">
          <h2 id="publish-title" className="font-serif text-xl font-semibold">Para publicar</h2>
          <ul className="sheet divide-y divide-rule">
            {[
              { href: `${API_BASE}/export/beforeafter.png?session_id=${sessionId}&year=${base.year}&kind=rgb&title=${title}`, icon: ImageIcon, label: `Imagen ${base.year} / ${current.year}`, dl: true },
              { href: `${API_BASE}/export/trend.png?session_id=${sessionId}&title=${encodeURIComponent(`Vegetación en ${zone.name}`)}`, icon: ImageIcon, label: 'Gráfico de tendencia', dl: true },
              { href: `${API_BASE}/export/stats.csv?session_id=${sessionId}`, icon: FileSpreadsheet, label: 'Cifras por año (CSV)', dl: true },
              { href: `${API_BASE}/export/report.html?session_id=${sessionId}`, icon: FileText, label: 'Reporte completo', dl: false },
            ].map(e => (
              <li key={e.label}>
                <a
                  href={e.href}
                  {...(e.dl ? { download: '' } : { target: '_blank', rel: 'noopener noreferrer' })}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-paper-2 transition-colors"
                >
                  <e.icon className="w-5 h-5 text-ink-2 shrink-0" aria-hidden />
                  <span className="font-semibold">{e.label}</span>
                  <Download className="w-4 h-4 ml-auto text-muted" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">Las imágenes incluyen el crédito «Contiene datos modificados de Copernicus Sentinel-2».</p>
        </section>
      </div>

      {/* Qué mide y qué no */}
      <section className="sheet p-4 max-w-[80ch]" aria-labelledby="limits-title">
        <h2 id="limits-title" className="flex items-center gap-2 font-semibold">
          <Info className="w-4 h-4 text-ink-2" aria-hidden /> Qué mide esta herramienta y qué no
        </h2>
        <ul className="mt-2 space-y-1.5 text-ink-2 list-disc pl-5">
          <li><b className="text-ink">«Vegetación» incluye bosque, pastos y cultivos.</b> Aún no distingue un bosque talado convertido en potrero: esa deforestación puede no aparecer como pérdida.</li>
          <li>Las cifras son estimaciones de un modelo entrenado con reglas espectrales, no mediciones de campo.</li>
          <li>Cada año se compara con una sola imagen de la misma temporada; nubes, crecientes de ríos o sequías pueden mover un año aislado.</li>
        </ul>
      </section>

      <div className="flex flex-wrap gap-3 border-t border-rule pt-6">
        <button onClick={onOpenExpert} className="btn btn-secondary">
          Ver el análisis completo en modo experto <ArrowRight className="w-4 h-4" />
        </button>
        <button onClick={onRestart} className="btn btn-quiet">
          <RotateCcw className="w-4 h-4" /> Analizar otra zona
        </button>
      </div>
    </div>
  );
}
