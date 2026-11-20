import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, ArrowRight, CalendarRange, Check, Circle, Columns2, Download, FileSpreadsheet, FileText, Film,
  Grid3x3, History, Image as ImageIcon, Info, Loader2, Map as MapIcon, Microscope, Newspaper, RotateCcw,
  Telescope, Thermometer,
} from 'lucide-react';
import type { BBox, LayerKind, ScenesResponse, SearchResponse, StreamLine, TimeSeries, Zone } from '../types';
import { useProgressStream } from '../hooks/useProgressStream';
import { useLayerBounds } from '../hooks/useLayerBounds';
import { useMapStats } from '../hooks/useMapStats';
import { PRESETS, bboxAreaKm2, bboxIsTooLarge, centerDms } from '../lib/geo';
import { RULES_DEFS, chartColor, dePhrase, phrase } from '../lib/classes';
import { applyYearEvent } from '../lib/yearProgress';
import AoiMap from './map/AoiMap';
import SwipeMap from './map/SwipeMap';
import TimelineMap from './map/TimelineMap';
import MapLegend from './MapLegend';
import GuidedHeat from './heat/GuidedHeat';
import GuidedMethod from './GuidedMethod';
import MapPanel from './MapPanel';
import ComparePanel from './ComparePanel';
import SpecimenLabel from './SpecimenLabel';
import type { DeterminationSlip } from './SpecimenLabel';
import Stamp from './Stamp';
import TrendChart from './TrendChart';
import YearMatrix from './YearMatrix';
import { GUIDED_SCENES_PER_YEAR, baseYear } from '../lib/guided';
import type { GuidedRun, GuidedStage, TaskId } from '../lib/guided';
import { HEAT_FIRST_YEAR } from '../lib/heat';

// ── Tipos y constantes ─────────────────────────────────────────────────────────

const N = GUIDED_SCENES_PER_YEAR;

const TASKS: { id: TaskId; label: string; detail: string }[] = [
  { id: 'scene', label: 'Buscar la imagen más despejada', detail: 'Entre las imágenes del último año, la que tiene menos nubes sobre la zona.' },
  { id: 'bands', label: 'Descargar la imagen', detail: 'Nueve bandas de luz, de lo visible al infrarrojo, y la máscara de nubes.' },
  { id: 'train', label: 'Aprender a reconocer la cobertura', detail: 'Bosque, pastos y cultivos, agua, suelo expuesto y zonas urbanas, con ejemplos del mapa ESA WorldCover.' },
  { id: 'map', label: 'Clasificar la zona', detail: 'Cada píxel de 10 × 10 m recibe una clase.' },
  { id: 'series', label: 'Revisar los 10 años anteriores', detail: `Hasta ${N} imágenes por año, clasificadas con el mismo modelo; cada píxel se decide por voto.` },
  { id: 'heat', label: 'Medir la temperatura', detail: 'Landsat 8/9 en dos fechas de referencia; la pestaña Calor permite comparar la serie observada con la cobertura.' },
];

const LAST_YEAR = new Date().getFullYear() - 1;
const API_BASE = '';

/** Cronómetro del análisis: el tiempo real es parte de la historia. */
function Elapsed({ since, running }: { since: number | null; running: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (since === null) return null;
  const sec = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="figure text-ink-2" aria-label="Tiempo transcurrido">
      {String(Math.floor(sec / 60)).padStart(2, '0')}:{String(sec % 60).padStart(2, '0')}
    </span>
  );
}

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
  mapReady: boolean;
  run: GuidedRun;
  setRun: React.Dispatch<React.SetStateAction<GuidedRun>>;
  /** Cambia cada vez que se entra al modo guiado: dispara la reanudación. */
  resumeKey: number;
}

const fmt = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: d });

// ── Componente ─────────────────────────────────────────────────────────────────

export default function GuidedFlow({
  stage, onStage, onSession, onMapReady, onOpenExpert, sessionId, zone, sceneInfo, mapReady, run: state, setRun, resumeKey,
}: GuidedFlowProps) {
  const { consume } = useProgressStream();
  const { bbox, zoneName, current, done, message, error } = state;
  const series = state.seriesSession === sessionId ? state.series : null;
  // La etiqueta se va llenando mientras corre el análisis
  const liveStats = useMapStats(stage === 'running' ? sessionId : null, done.length);

  const [focus, setFocus] = useState<{ bbox: BBox; n: number } | undefined>();
  const setBbox = (b: BBox) => setRun(r => ({ ...r, bbox: b }));
  const setZoneName = (n: string) => setRun(r => ({ ...r, zoneName: n }));
  const setCurrent = (t: TaskId | null) => setRun(r => ({ ...r, current: t }));
  const setMessage = (m: string) => setRun(r => ({ ...r, message: m }));
  const setError = (e: GuidedRun['error']) => setRun(r => ({ ...r, error: e }));

  const zoneError = bboxIsTooLarge(bbox)
    ? 'La zona es demasiado grande: dibuja una más pequeña (máximo 500 km²).'
    : null;

  /** Envuelve un stream NDJSON en una promesa que resuelve con la línea final. */
  const stream = useCallback((url: string, body: object) =>
    new Promise<StreamLine>((resolve, reject) => {
      consume(
        url, 'POST', JSON.stringify(body),
        l => setRun(r => ({ ...r, message: l.message, years: applyYearEvent(r.years, l.event) })),
        l => resolve(l),
        l => reject(new Error(l.error ?? l.message)),
      );
    }), [consume, setRun]);

  const finish = (t: TaskId) => setRun(r => ({ ...r, done: [...r.done, t] }));

  /** Temperatura contra el año base. No es fatal: si Landsat falla, la pestaña Calor permite reintentar. */
  const runHeat = async (sid: string, s: TimeSeries | null) => {
    if (!s) return;
    setRun(r => ({ ...r, current: 'heat', message: '' }));
    try {
      await stream(`${API_BASE}/heat`, { session_id: sid, year: Math.max(baseYear(s), HEAT_FIRST_YEAR) });
    } catch {
      /* se ofrece de nuevo en la pestaña Calor */
    }
    setRun(r => ({ ...r, current: null, done: [...r.done, 'heat'] }));
  };

  /** Solo el último paso: la serie de 10 años sobre una sesión ya clasificada (p. ej. del modo experto). */
  const runSeriesOnly = async (sid: string) => {
    onStage('running');
    setRun(r => ({
      ...r, done: ['scene', 'bands', 'train', 'map'], current: 'series', error: null, message: '',
      startedAt: Date.now(), years: applyYearEvent(r.years, { plan: { years: [], cached: [], scenes_per_year: N, current_year: LAST_YEAR } }),
    }));
    try {
      const last = await stream(`${API_BASE}/timeseries`, { session_id: sid, years_back: 10, scenes_per_year: N });
      setRun(r => ({ ...r, series: last.series ?? null, seriesSession: sid, current: null, done: [...r.done, 'series'] }));
      await runHeat(sid, last.series ?? null);
      onStage('results');
    } catch (e) {
      setRun(r => ({ ...r, current: null, error: { task: 'series', text: e instanceof Error ? e.message : 'Error inesperado.' } }));
    }
  };

  // Al entrar al modo guiado con una sesión ya clasificada, retomarla en vez de empezar de cero
  useEffect(() => {
    if (!resumeKey || !sessionId || !mapReady || state.current) return;
    if (state.series && state.seriesSession === sessionId) {
      onStage('results');
      return;
    }
    let alive = true;
    fetch(`${API_BASE}/timeseries/summary?session_id=${sessionId}`)
      .then(r => (r.ok ? r.json() : null))
      .then((s: TimeSeries | null) => {
        if (!alive) return;
        // Con al menos 3 años además del actual ya hay una serie que mostrar
        if (s && s.points.length >= 4) {
          setRun(r => ({ ...r, series: s, seriesSession: sessionId, error: null }));
          onStage('results');
        } else {
          runSeriesOnly(sessionId);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // Solo al entrar al modo guiado (resumeKey), no en cada cambio de estado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeKey]);

  const run = async () => {
    onStage('running');
    setRun(r => ({
      ...r, done: [], error: null, series: null, seriesSession: null, startedAt: Date.now(),
      // Plan previsto: se reemplaza con el real cuando el catálogo responde
      years: applyYearEvent(r.years, {
        plan: { years: Array.from({ length: 11 }, (_, i) => LAST_YEAR - 10 + i), cached: [], scenes_per_year: N, current_year: LAST_YEAR },
      }),
    }));
    const zoneNow: Zone = { name: zoneName, bbox };
    let task: TaskId = 'scene';
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
      // El modo guiado entrena con WorldCover: distingue bosque de pastos y reconoce lo urbano
      await stream(`${API_BASE}/train`, { session_id: session.session_id, method: 'worldcover' });
      finish(task);
      task = 'map'; setCurrent(task);
      await stream(`${API_BASE}/predict`, { session_id: session.session_id });
      onMapReady();
      finish(task);

      // 5. Serie de 10 años
      task = 'series'; setCurrent(task);
      const last = await stream(`${API_BASE}/timeseries`, { session_id: session.session_id, years_back: 10, scenes_per_year: N });
      setRun(r => ({ ...r, series: last.series ?? null, seriesSession: session.session_id }));
      finish(task);
      setCurrent(null);

      // 6. Temperatura (no fatal)
      await runHeat(session.session_id, last.series ?? null);
      onStage('results');
    } catch (e) {
      setError({ task, text: e instanceof Error ? e.message : 'Error inesperado.' });
      setCurrent(null);
    }
  };

  // ── Etapa 1: zona ──────────────────────────────────────────────────────────
  if (stage === 'zone') {
    const pick = (p: (typeof PRESETS)[number]) => {
      setBbox(p.bbox);
      setZoneName(p.name);
      setFocus(f => ({ bbox: p.bbox, n: (f?.n ?? 0) + 1 }));
    };
    const cta = (
      <button
        onClick={run}
        disabled={!!zoneError}
        className="btn btn-primary w-full !min-h-12 !whitespace-normal !leading-tight py-2.5 text-left"
      >
        <Telescope className="w-4.5 h-4.5 shrink-0" />
        <span>Analizar {zoneName === 'Zona personalizada' ? 'esta zona' : zoneName.split(',')[0]}: últimos 10 años</span>
      </button>
    );
    const wait = (
      <p className="text-sm text-muted">
        Tarda entre <span className="figure">4</span> y <span className="figure">6</span> minutos: son hasta <span className="figure">{11 * N}</span> imágenes
        gratuitas del satélite Sentinel-2, <span className="figure">{N}</span> por año.
      </p>
    );
    return (
      <div key="zone" className="grid gap-5 lg:gap-7 lg:grid-cols-[minmax(0,1fr)_340px] items-start animate-fade-in">
        {/* Móvil: zonas en una fila desplazable y la acción, antes del mapa */}
        <div className="lg:hidden space-y-3 min-w-0">
          <p className="field-label">Elige un lugar o dibuja tu zona en el mapa</p>
          <ul className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scroll-px-4 snap-x" aria-label="Zonas de ejemplo">
            {PRESETS.map(p => (
              <li key={p.name} className="snap-start shrink-0">
                <button
                  type="button"
                  aria-pressed={zoneName === p.name}
                  onClick={() => pick(p)}
                  className={`text-left rounded-[5px] border px-3 py-2 w-52 h-full ${
                    zoneName === p.name ? 'border-stamp bg-stamp-tint' : 'border-rule bg-paper'
                  }`}
                >
                  <span className={`block text-sm font-semibold ${zoneName === p.name ? 'text-stamp-2' : ''}`}>{p.name}</span>
                  <span className="block text-xs text-muted line-clamp-2">{p.description}</span>
                </button>
              </li>
            ))}
          </ul>
          {zoneError && <p role="alert" className="text-sm text-signal font-semibold">{zoneError}</p>}
          {cta}
          {wait}
        </div>

        <AoiMap
          bbox={bbox}
          onChange={b => { setBbox(b); setZoneName('Zona personalizada'); }}
          focus={focus}
          heightClass="h-[380px] lg:h-[calc(100dvh-17.5rem)] lg:min-h-[480px]"
        >
          <div className="hidden sm:block"><SpecimenLabel zone={{ name: zoneName, bbox }} /></div>
        </AoiMap>

        {/* Escritorio: lista vertical junto al mapa (adaptación registrada en el brief) */}
        <div className="hidden lg:block space-y-5">
          <fieldset>
            <legend className="field-label mb-2">Elige un lugar o dibuja tu zona en el mapa</legend>
            <ul className="sheet divide-y divide-rule overflow-hidden">
              {PRESETS.map(p => {
                const on = zoneName === p.name;
                return (
                  <li key={p.name}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => pick(p)}
                      className={`w-full text-left px-3.5 py-2.5 transition-colors ${on ? 'bg-stamp-tint' : 'hover:bg-paper-2'}`}
                    >
                      <span className={`block font-semibold ${on ? 'text-stamp-2' : ''}`}>{p.name}</span>
                      <span className="block text-sm text-ink-2">{p.description}</span>
                      <span className="figure block text-xs text-muted mt-0.5">
                        {centerDms(p.bbox)} · {bboxAreaKm2(p.bbox).toLocaleString('es-CO', { maximumFractionDigits: 0 })} km²
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          {zoneError && <p role="alert" className="text-sm text-signal font-semibold">{zoneError}</p>}
          {cta}
          {wait}
        </div>
      </div>
    );
  }

  // ── Etapa 2: análisis ──────────────────────────────────────────────────────
  if (stage === 'running') {
    const working = current !== null && !error;
    return (
      <div key="running" className="grid gap-6 lg:gap-8 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] items-start animate-fade-in">
        <div className="space-y-4">
          <p className="flex items-baseline justify-between gap-4 text-sm">
            <span className="text-ink-2">
              {error ? 'El análisis se detuvo' : <>Paso <span className="figure">{Math.min(done.length + 1, TASKS.length)}</span> de <span className="figure">{TASKS.length}</span></>}
            </span>
            <Elapsed since={state.startedAt} running={working} />
          </p>
          <ol className="sheet divide-y divide-rule" aria-live="polite">
            {TASKS.map(t => {
              const isDone = done.includes(t.id);
              const isCurrent = current === t.id;
              const failed = error?.task === t.id;
              return (
                <li key={t.id} className={`flex gap-3 px-4 py-3 ${isCurrent ? 'bg-stamp-tint/60' : ''}`}>
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
          {error ? (
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => (error.task === 'series' && sessionId && mapReady ? runSeriesOnly(sessionId) : run())}
                className="btn btn-primary"
              >
                <RotateCcw className="w-4 h-4" /> Reintentar
              </button>
              <button onClick={() => onStage('zone')} className="btn btn-secondary">Elegir otra zona</button>
            </div>
          ) : (
            <p className="text-sm text-muted max-w-[52ch]">
              Lo más largo es revisar los años anteriores: cada imagen se descarga y se clasifica por separado
              para que una nube o una creciente no decidan el año.
            </p>
          )}
        </div>

        {/* El pliego se va armando: etiqueta del ejemplar y avance año por año */}
        <div className="flex flex-wrap items-start gap-5 min-w-0">
          <SpecimenLabel
            zone={{ name: zoneName, bbox }}
            scene={sceneInfo}
            cloudFraction={liveStats?.cloud_fraction}
            classes={liveStats?.classes}
            classDefs={liveStats?.class_defs}
            nScenes={liveStats?.n_scenes}
          />
          <YearMatrix progress={state.years} mainLabel="bosque" className="flex-1 min-w-[280px] max-w-xl" />
        </div>
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

type ResultTab = 'summary' | 'map' | 'compare' | 'heat' | 'method';

const RESULT_TABS: { id: ResultTab; label: string; icon: typeof Info }[] = [
  { id: 'summary', label: 'Resumen', icon: Newspaper },
  { id: 'map', label: 'Mapa', icon: MapIcon },
  { id: 'compare', label: 'Comparar años', icon: CalendarRange },
  { id: 'heat', label: 'Calor', icon: Thermometer },
  { id: 'method', label: 'Cómo se hizo', icon: Microscope },
];

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
  const [tab, setTab] = useState<ResultTab>('summary');
  const [view, setView] = useState<'swipe' | 'timeline'>('swipe');
  const [layer, setLayer] = useState<LayerKind>('rgb');
  const [grid, setGrid] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  // El sello cae una sola vez, al llegar a los resultados
  const [fresh, setFresh] = useState(true);
  const { bounds } = useLayerBounds(sessionId);
  const stats = useMapStats(sessionId, 'guided');

  useEffect(() => {
    const t = setTimeout(() => setFresh(false), 1400);
    return () => clearTimeout(t);
  }, []);

  if (!series) {
    return <p className="text-ink-2">No hay serie temporal para esta zona. <button className="underline" onClick={onRestart}>Elegir otra zona</button></p>;
  }

  const current = series.points[series.points.length - 1];
  const used = new Set(series.years_used_for_trend);
  const base = series.points.find(p => p.year === baseYear(series))!;
  const defs = series.classes ?? RULES_DEFS;
  const main = defs[0];
  const mainPhrase = phrase(main);
  const veg = series.trends[main.key];
  const total = series.total_hectares;
  const method = series.scenes_per_year ?? 1;
  const shownYear = year ?? current.year;
  // Años sin suficientes píxeles clasificados: hueco en el gráfico, nunca 0
  const chart = series.points.map(p => ({
    year: p.year,
    ha: used.has(p.year) && p.stats[main.key]?.percent_clear != null
      ? Math.round((p.stats[main.key].percent_clear! / 100) * total)
      : null,
  }));
  const skipped = series.points.filter(p => !used.has(p.year)).map(p => p.year);
  const span = `${series.years_used_for_trend[0]}–${current.year}`;

  // Otras clases con cambio significativo (en Hidroituango la historia es el agua)
  const others = defs.slice(1)
    .map(d => ({ d, t: series.trends[d.key] }))
    .filter(o => o.t?.significant);
  const slips: DeterminationSlip[] = series.points.filter(p => p.year !== current.year).map(p => ({
    year: p.year,
    date: (p.n_scenes ?? 1) > 1 ? `${p.n_scenes} escenas` : p.scene.datetime.slice(0, 10),
    values: Object.fromEntries(defs.map(d => [d.key, p.stats[d.key]?.percent_clear ?? null])),
  }));
  const title = encodeURIComponent(zone.name);
  const mapHeight = 'h-[440px] lg:h-[min(68dvh,680px)]';
  const frameKind = layer === 'class' ? 'class' : 'rgb';
  const label = (maxSlips?: number) => (
    <SpecimenLabel
      zone={zone} scene={sceneInfo} cloudFraction={stats?.cloud_fraction} classes={stats?.classes} classDefs={defs}
      slips={slips} vegetationTrend={veg} maxSlips={maxSlips} nScenes={stats?.n_scenes} compact={maxSlips !== undefined}
    />
  );
  const limits = (
    <section aria-labelledby="limits-title" className="border-t-2 border-ink pt-3 max-w-[72ch]">
      <h2 id="limits-title" className="flex items-center gap-2 font-semibold">
        <Info className="w-4 h-4 text-ink-2" aria-hidden /> Qué mide esta herramienta y qué no
      </h2>
      <ul className="mt-2.5 space-y-2 text-[0.9375rem] text-ink-2 list-disc pl-5 marker:text-rule-strong">
        {main.key === 'forest' ? (
          <>
            <li><b className="text-ink">El bosque se distingue de pastos y cultivos</b>, así que un bosque talado convertido en potrero cuenta como pérdida de bosque.</li>
            <li>El modelo aprende con ejemplos del mapa ESA WorldCover 2021 (exactitud global ≈ 76 %). Las cifras son estimaciones, no mediciones de campo.</li>
          </>
        ) : (
          <>
            <li><b className="text-ink">«Vegetación» incluye bosque, pastos y cultivos.</b> Con este método no se distingue un bosque talado convertido en potrero: esa deforestación puede no aparecer como pérdida.</li>
            <li>Las cifras son estimaciones de un modelo entrenado con reglas espectrales, no mediciones de campo.</li>
          </>
        )}
        {method > 1 ? (
          <li>
            Cada año es un <b className="text-ink">compuesto de hasta <span className="figure">{method}</span> imágenes</b> clasificadas por
            separado; cada píxel toma la clase más votada. Una nube o una creciente puntual ya no deciden el año, pero una sequía o
            una inundación larga sí pueden moverlo.
          </li>
        ) : (
          <li>Cada año se compara con una sola imagen de la misma temporada; nubes, crecientes de ríos o sequías pueden mover un año aislado.</li>
        )}
      </ul>
    </section>
  );

  const summaryView = (
    <div className="space-y-9">
      {/* Hallazgo y sello */}
      <section className="grid gap-x-10 gap-y-5 lg:grid-cols-[minmax(0,1fr)_auto] items-start">
        <div className="max-w-[46rem]">
          {!veg ? (
            <p className="lede">No hay suficientes años bien clasificados para estimar una tendencia en {zone.name}.</p>
          ) : veg.significant ? (
            <p className="lede">
              En {zone.name}, {mainPhrase} {veg.slope < 0 ? 'se redujo' : 'aumentó'}{' '}
              <b className={`font-semibold ${veg.slope < 0 ? 'text-signal' : ''}`}>
                <span className="figure">{fmt(Math.abs(veg.ha_per_year ?? 0), 0)}</span> hectáreas por año
              </b>{' '}
              entre <span className="figure">{series.years_used_for_trend[0]}</span> y <span className="figure">{current.year}</span>.
            </p>
          ) : (
            // Sin significancia no se afirma un cambio: la cifra pasa a la línea secundaria
            <p className="lede">
              En {zone.name}, los datos no muestran un cambio claro {dePhrase(main)} entre{' '}
              <span className="figure">{series.years_used_for_trend[0]}</span> y <span className="figure">{current.year}</span>.
            </p>
          )}
          {veg && (
            <p className="mt-4 text-ink-2 max-w-[68ch]">
              {veg.significant
                ? <>Es una tendencia <b className="text-ink">estadísticamente significativa</b> (Mann-Kendall p = <span className="figure">{fmt(veg.p_value, 3)}</span>): es poco probable que se deba al azar.</>
                : <>La estimación es <span className="figure">{veg.slope > 0 ? '+' : '−'}{fmt(Math.abs(veg.ha_per_year ?? 0), 0)}</span> ha por año, pero <b className="text-ink">no es estadísticamente significativa</b> (Mann-Kendall p = <span className="figure">{fmt(veg.p_value, 3)}</span>): puede deberse al azar.</>}{' '}
              Con un 95 % de confianza, el cambio anual está entre <span className="figure">{fmt(veg.ha_per_year_low, 0)}</span> y{' '}
              <span className="figure">{fmt(veg.ha_per_year_high, 0)}</span> ha.
            </p>
          )}
          {others.length > 0 && (
            <p className="mt-2 text-ink-2 max-w-[68ch]">
              Sí cambió de forma significativa{' '}
              {others.map((o, i) => (
                <span key={o.d.key}>
                  {i > 0 && ' y '}
                  {phrase(o.d)} (<span className="figure">{o.t!.slope > 0 ? '+' : '−'}{fmt(Math.abs(o.t!.ha_per_year ?? 0), 0)}</span> ha/año)
                </span>
              ))}.
            </p>
          )}
        </div>
        {veg && <Stamp trend={veg} span={span} press={fresh} className="lg:mt-3 lg:mr-3 justify-self-start" />}
      </section>

      {/* La evidencia: antes/después o año por año sobre el mismo encuadre */}
      <section className="sheet overflow-hidden" aria-label="Imágenes de la zona">
        <div className="p-3 border-b border-rule bg-paper-2 flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <div className="segmented" role="group" aria-label="Modo de comparación">
            <button aria-pressed={view === 'swipe'} onClick={() => setView('swipe')} className="inline-flex items-center gap-1.5">
              <Columns2 className="w-4 h-4" aria-hidden /> Antes y después
            </button>
            <button
              aria-pressed={view === 'timeline'}
              onClick={() => { setView('timeline'); if (layer === 'change') setLayer('rgb'); }}
              className="inline-flex items-center gap-1.5"
            >
              <History className="w-4 h-4" aria-hidden /> Año por año
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Capa">
            <button aria-pressed={layer === 'rgb'} onClick={() => setLayer('rgb')}>Imagen</button>
            <button aria-pressed={layer === 'class'} onClick={() => setLayer('class')}>Clasificación</button>
            {view === 'swipe' && <button aria-pressed={layer === 'change'} onClick={() => setLayer('change')}>Cambios</button>}
          </div>
          <button type="button" onClick={() => setGrid(g => !g)} aria-pressed={grid} className={`btn !min-h-9 px-3 text-sm ${grid ? 'btn-primary' : 'btn-secondary'}`}>
            <Grid3x3 className="w-4 h-4" /> Retícula
          </button>
          <div className="basis-full xl:basis-auto"><MapLegend kind={layer} classDefs={defs} /></div>
        </div>
        {bounds && view === 'timeline' && (
          <TimelineMap
            sessionId={sessionId}
            bounds={bounds}
            series={series}
            main={main}
            zoneName={zone.name}
            year={shownYear}
            onYear={setYear}
            kind={frameKind}
            graticule={grid}
            height={mapHeight}
          />
        )}
        {bounds && view === 'swipe' && (layer === 'change' ? (
          <SwipeMap
            bounds={bounds}
            after={{ url: `${API_BASE}/layer?session_id=${sessionId}&kind=change&year=${base.year}&m=${method}`, label: 'Cambios' }}
            opacity={0.9}
            graticule={grid}
            height={mapHeight}
          >
            <div className="hidden sm:block">{label(2)}</div>
          </SwipeMap>
        ) : (
          <SwipeMap
            bounds={bounds}
            before={{ url: `${API_BASE}/layer?session_id=${sessionId}&kind=${layer}&year=${base.year}&m=${method}`, label: String(base.year) }}
            after={{ url: `${API_BASE}/layer?session_id=${sessionId}&kind=${layer}&year=${current.year}&m=${method}`, label: String(current.year) }}
            opacity={1}
            graticule={grid}
            height={mapHeight}
          >
            <div className="hidden sm:block">{label(2)}</div>
          </SwipeMap>
        ))}
        <p className="px-4 py-2.5 border-t border-rule text-sm text-ink-2">
          {view === 'timeline'
            ? layer === 'class'
              ? <>La clasificación de cada año, con el mismo modelo. La cifra de cada ficha es el % de {main.label.toLowerCase()} sobre el área clasificada.</>
              : method > 1
              ? <>La imagen de cada año es la de sus fechas más despejadas, así que el tono de los potreros cambia con la temporada; la cifra sale del voto de todas las escenas del año.</>
              : <>Una imagen por año, de la misma temporada y con el mismo contraste.</>
            : layer === 'change'
            ? <>Solo se pintan los píxeles que cambiaron de clase entre <span className="figure">{base.year}</span> y <span className="figure">{current.year}</span>.</>
            : <>Arrastra el divisor: a la izquierda <span className="figure">{base.year}</span>, a la derecha <span className="figure">{current.year}</span>.</>}
        </p>
      </section>

      {/* En móvil, y en la línea de tiempo, la etiqueta con sus fichas va fuera del mapa */}
      <div className={view === 'timeline' ? 'xl:hidden' : 'sm:hidden'}>{label()}</div>

      <div className={`grid gap-7 items-start ${view === 'timeline' ? 'xl:grid-cols-[minmax(0,1fr)_300px]' : 'lg:grid-cols-[minmax(0,1fr)_340px]'}`}>
        <div className="space-y-7 min-w-0">
          {/* Evolución */}
          <figure className="sheet p-4 sm:p-5">
            <figcaption className="mb-2 pr-40">
              <span className="block font-serif text-xl font-semibold">Hectáreas de {main.label.toLowerCase()} por año</span>
              <span className="block text-sm text-ink-2 mt-0.5">
                {veg
                  ? <>Línea discontinua: tendencia de Theil-Sen ({veg.significant ? 'significativa' : 'no significativa'}, p = <span className="figure">{fmt(veg.p_value, 3)}</span>); franja: intervalo de confianza del 95 %.</>
                  : 'Sin años suficientes para estimar una tendencia.'}
              </span>
            </figcaption>
            <TrendChart
              points={chart}
              trend={veg}
              color={chartColor(main)}
              label={main.label}
              activeYear={view === 'timeline' ? shownYear : null}
              onYear={y => { setYear(y); setView('timeline'); if (layer === 'change') setLayer('rgb'); }}
            />
            <p className="text-sm text-muted mt-2">
              Estimadas sobre el área sin nubes · toca un año para verlo en el mapa
              {skipped.length > 0 && <> · sin datos suficientes: <span className="figure">{skipped.join(', ')}</span></>}
            </p>
          </figure>

          {/* Para publicar */}
          <section className="space-y-3" aria-labelledby="publish-title">
            <h2 id="publish-title" className="font-serif text-xl font-semibold">Para publicar</h2>
            <ul className="sheet grid sm:grid-cols-2 [&>li]:border-b [&>li]:border-rule sm:[&>li:nth-child(odd)]:border-r overflow-hidden -mb-px">
              {[
                { href: `${API_BASE}/export/beforeafter.png?session_id=${sessionId}&year=${base.year}&kind=rgb&title=${title}`, icon: ImageIcon, label: `Imagen ${base.year} / ${current.year}`, hint: 'PNG con fechas, escala y crédito', dl: true },
                { href: `${API_BASE}/export/timelapse.gif?session_id=${sessionId}&kind=rgb&title=${title}`, icon: Film, label: 'Animación año por año', hint: 'GIF con el año y la cifra', dl: true },
                { href: `${API_BASE}/export/trend.png?session_id=${sessionId}&title=${encodeURIComponent(`${main.label} en ${zone.name}`)}`, icon: ImageIcon, label: 'Gráfico de tendencia', hint: 'PNG con IC 95 % y veredicto', dl: true },
                { href: `${API_BASE}/export/beforeafter.png?session_id=${sessionId}&year=${base.year}&kind=class&title=${title}`, icon: MapIcon, label: `Clasificación ${base.year} / ${current.year}`, hint: 'PNG con las clases de cada año', dl: true },
                { href: `${API_BASE}/export/stats.csv?session_id=${sessionId}`, icon: FileSpreadsheet, label: 'Cifras por año', hint: 'CSV para hoja de cálculo', dl: true },
                { href: `${API_BASE}/export/report.html?session_id=${sessionId}`, icon: FileText, label: 'Reporte completo', hint: 'Página imprimible a PDF', dl: false },
              ].map(e => (
                <li key={e.label}>
                  <a
                    href={e.href}
                    {...(e.dl ? { download: '' } : { target: '_blank', rel: 'noopener noreferrer' })}
                    className="flex items-center gap-3 px-4 py-3 h-full hover:bg-paper-2 transition-colors group"
                  >
                    <e.icon className="w-5 h-5 text-ink-2 shrink-0" aria-hidden />
                    <span className="min-w-0">
                      <span className="block font-semibold group-hover:text-stamp-2">{e.label}</span>
                      <span className="block text-sm text-muted">{e.hint}</span>
                    </span>
                    <Download className="w-4 h-4 ml-auto text-muted shrink-0" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted">Las imágenes incluyen el crédito «Contiene datos modificados de Copernicus Sentinel-2».</p>
          </section>
          {view === 'timeline' && limits}
        </div>

        {view === 'timeline'
          ? <div className="hidden xl:block">{label()}</div>
          : limits}
      </div>
    </div>
  );

  return (
    <div className="space-y-7 animate-fade-in">
      {/* Mismo contenido que el modo experto, organizado por pestañas */}
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
        <div className="segmented !flex-nowrap" role="tablist" aria-label="Resultados">
          {RESULT_TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="guided-tabpanel"
              onClick={() => setTab(t.id)}
              className="inline-flex items-center gap-2 whitespace-nowrap"
            >
              <t.icon className="w-4 h-4" aria-hidden />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div id="guided-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} key={tab} className="animate-fade-in">
        {tab === 'summary' && summaryView}
        {tab === 'map' && <MapPanel sessionId={sessionId} zone={zone} sceneInfo={sceneInfo} />}
        {tab === 'compare' && (
          <ComparePanel
            sessionId={sessionId}
            sceneYear={current.year}
            zone={zone}
            sceneInfo={sceneInfo}
            initialSeries={series}
            initialYear={base.year}
            lockMethod
          />
        )}
        {tab === 'heat' && <GuidedHeat sessionId={sessionId} year={base.year} bounds={bounds} />}
        {tab === 'method' && <GuidedMethod sessionId={sessionId} sceneInfo={sceneInfo} onOpenExpert={onOpenExpert} />}
      </div>

      <div className="flex flex-wrap gap-3 border-t border-rule pt-6">
        <button onClick={onOpenExpert} className="btn btn-secondary">
          Ajustar parámetros en modo experto <ArrowRight className="w-4 h-4" />
        </button>
        <button onClick={onRestart} className="btn btn-quiet">
          <RotateCcw className="w-4 h-4" /> Analizar otra zona
        </button>
      </div>
    </div>
  );
}
