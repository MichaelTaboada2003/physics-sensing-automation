import { useEffect, useRef, useState } from 'react';
import { ImageOverlay, MapContainer, Pane } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import { Film, Loader2, Pause, Play } from 'lucide-react';
import type { ClassDef, TimeSeries } from '../../types';
import BaseLayers from './basemaps';
import Graticule from './Graticule';
import { FitBounds } from './SwipeMap';

export type FrameKind = 'rgb' | 'class' | 'ndvi';

interface TimelineMapProps {
  sessionId: string;
  bounds: LatLngBoundsExpression;
  series: TimeSeries;
  /** Clase principal (bosque o vegetación): su cifra acompaña a cada año. */
  main: ClassDef;
  zoneName: string;
  /** Año visible (controlado: el gráfico de tendencia lo comparte). */
  year: number;
  onYear: (year: number) => void;
  kind: FrameKind;
  opacity?: number;
  graticule?: boolean;
  height?: string;
  /** Contenido superpuesto abajo a la derecha (p. ej. la etiqueta del ejemplar). */
  children?: React.ReactNode;
}

const FRAME_MS = 1100;
const es = (v: number, d = 0) => v.toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: d });

/**
 * Línea de tiempo: un cuadro por año sobre el mismo encuadre y contraste.
 * Las fichas de determinación son el control: una por año, la visible se levanta.
 */
export default function TimelineMap({
  sessionId, bounds, series, main, zoneName, year, onYear, kind, opacity = 1, graticule = false,
  height = 'h-[440px] lg:h-[600px]', children,
}: TimelineMapProps) {
  const years = series.points.map(p => p.year);
  const used = new Set(series.years_used_for_trend);
  const method = series.scenes_per_year ?? 1;
  const [playing, setPlaying] = useState(false);
  const [fast, setFast] = useState(false);
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const [prev, setPrev] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const last = useRef(year);

  const key = (y: number) => `${kind}-${y}`;
  const ready = years.every(y => loaded.has(key(y)));
  const nLoaded = years.filter(y => loaded.has(key(y))).length;

  const markLoaded = (k: string) => setLoaded(s => (s.has(k) ? s : new Set(s).add(k)));

  // El cuadro anterior queda debajo mientras el nuevo aparece (sin dejar ver el mapa base)
  useEffect(() => {
    if (last.current === year) return;
    setPrev(last.current);
    last.current = year;
    const t = setTimeout(() => setPrev(null), 420);
    return () => clearTimeout(t);
  }, [year]);

  // Reproducción: avanza un año por cuadro; el último se sostiene el doble y vuelve a empezar
  useEffect(() => {
    if (!playing || !ready) return;
    const i = years.indexOf(year);
    const atEnd = i === years.length - 1;
    const t = setTimeout(
      () => onYear(years[atEnd ? 0 : i + 1]),
      (atEnd ? 2.2 : 1) * (fast ? FRAME_MS / 2 : FRAME_MS),
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, ready, year, fast]);

  // La ficha visible siempre queda a la vista dentro de la tira (sin mover la página)
  useEffect(() => {
    const box = strip.current;
    const el = box?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!box || !el) return;
    const left = el.offsetLeft - box.offsetLeft;
    if (left < box.scrollLeft || left + el.offsetWidth > box.scrollLeft + box.clientWidth) {
      box.scrollTo({ left: left - box.clientWidth / 2 + el.offsetWidth / 2, behavior: 'smooth' });
    }
  }, [year]);

  const toggle = () => {
    if (!playing && year === years[years.length - 1]) onYear(years[0]);
    setPlaying(p => !p);
  };

  const pick = (y: number) => {
    setPlaying(false);
    onYear(y);
  };

  const point = series.points.find(p => p.year === year) ?? series.points[series.points.length - 1];
  const share = point.stats[main.key]?.percent_clear ?? null;
  const comparable = used.has(point.year) && share !== null;
  const ha = comparable ? (share / 100) * series.total_hectares : null;
  const gifKind = kind === 'class' ? 'class' : 'rgb';

  return (
    <div>
      <div className={`relative ${height} overflow-hidden select-none bg-paper-2`}>
        <MapContainer bounds={bounds} className="h-full w-full" scrollWheelZoom zoomSnap={0.25} zoomDelta={0.5}>
          <BaseLayers />
          <FitBounds bounds={bounds} />
          <Pane name="frames" style={{ zIndex: 450 }}>
            {years.map(y => (
              <ImageOverlay
                key={key(y)}
                url={`/layer?session_id=${sessionId}&kind=${kind}&year=${y}&m=${method}`}
                bounds={bounds}
                opacity={y === year || y === prev ? opacity : 0}
                zIndex={y === year ? 3 : y === prev ? 2 : 1}
                className="pixelated frame"
                eventHandlers={{ load: () => markLoaded(key(y)), error: () => markLoaded(key(y)) }}
              />
            ))}
          </Pane>
          {graticule && <Graticule />}
        </MapContainer>

        {/* Año y cifra del cuadro visible */}
        <div
          className="absolute top-3 left-14 z-[1000] bg-paper border border-rule-strong rounded-[4px] px-3 py-1.5 shadow-[var(--shadow-sheet)] pointer-events-none"
          aria-live={playing ? 'off' : 'polite'}
        >
          <p className="figure text-[1.75rem] leading-none font-bold">{point.year}</p>
          <p className="text-sm mt-1">
            {comparable
              ? <><span className="text-ink-2">{main.label}</span> <span className="figure font-bold">{es(ha!)} ha</span></>
              : <span className="text-muted">Sin datos suficientes</span>}
          </p>
          <p className="text-xs text-muted">
            {(point.n_scenes ?? 1) > 1
              ? <>voto de <span className="figure">{point.n_scenes}</span> escenas</>
              : <>escena del <span className="figure">{point.scene.datetime.slice(0, 10)}</span></>}
          </p>
        </div>

        {!ready && (
          <p className="absolute top-3 right-14 z-[1000] inline-flex items-center gap-2 bg-paper border border-rule-strong rounded-[4px] px-2.5 py-1 text-sm shadow-[var(--shadow-sheet)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-stamp" aria-hidden />
            Cargando años <span className="figure">{nLoaded}/{years.length}</span>
          </p>
        )}
        {children && <div className="absolute right-3 bottom-3 z-[1000] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-4.75rem)] overflow-y-auto">{children}</div>}
      </div>

      {/* Reproducción y fichas por año */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 px-3 pt-3 border-t border-rule bg-paper-2">
        <div className="flex items-center gap-2 pb-3">
          <button type="button" onClick={toggle} disabled={!ready} className="btn btn-primary !min-h-10 px-3.5">
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {playing ? 'Pausar' : 'Reproducir'}
          </button>
          <button
            type="button"
            onClick={() => setFast(f => !f)}
            aria-pressed={fast}
            title="Velocidad de reproducción"
            className={`btn !min-h-10 px-3 figure ${fast ? 'btn-primary' : 'btn-secondary'}`}
          >
            2×
          </button>
          <a
            href={`/export/timelapse.gif?session_id=${sessionId}&kind=${gifKind}&title=${encodeURIComponent(zoneName)}`}
            download
            className="btn btn-secondary !min-h-10 px-3 sm:hidden xl:inline-flex"
            title="Animación con año, cifra y crédito, lista para publicar"
          >
            <Film className="w-4 h-4" /> GIF
          </a>
        </div>
        <div
          ref={strip}
          role="group"
          aria-label="Año visible"
          className="flex-1 min-w-0 flex gap-1 overflow-x-auto pt-2.5 px-1 -mx-1 sm:mx-0"
          onKeyDown={e => {
            const i = years.indexOf(year);
            if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); pick(years[i - 1]); }
            if (e.key === 'ArrowRight' && i < years.length - 1) { e.preventDefault(); pick(years[i + 1]); }
          }}
        >
          {series.points.map(p => {
            const v = p.stats[main.key]?.percent_clear ?? null;
            const ok = used.has(p.year) && v !== null;
            return (
              <button
                key={p.year}
                type="button"
                className="year-slip"
                aria-pressed={p.year === year}
                data-excluded={!ok}
                onClick={() => pick(p.year)}
              >
                <span className="figure block text-sm font-bold leading-tight">{p.year}</span>
                <span className="figure block text-xs leading-tight mt-0.5 whitespace-nowrap">
                  {ok ? `${es(v, 1)} %` : 'sin datos'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
