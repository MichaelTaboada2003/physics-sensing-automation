import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOverlay, MapContainer, Pane, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import { GripVertical } from 'lucide-react';
import BaseLayers from './basemaps';
import Graticule from './Graticule';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OverlayLayer {
  url: string;
  label: string;
}

interface SwipeMapProps {
  bounds: LatLngBoundsExpression;
  /** Capa izquierda (antes).  Si se omite, el mapa muestra solo `after` sin cortina. */
  before?: OverlayLayer;
  after: OverlayLayer;
  opacity: number;
  height?: string;
  /** Contenido superpuesto abajo a la derecha (p. ej. la etiqueta del ejemplar). */
  children?: React.ReactNode;
  /** Muestra la retícula de coordenadas. */
  graticule?: boolean;
}

// ── Recorte de panes (técnica de leaflet-side-by-side) ─────────────────────────
// Los panes viven en coordenadas de "layer point"; se recortan con `clip`
// en función de la posición del divisor sobre el contenedor del mapa.

function PaneClipper({ ratio, enabled }: { ratio: number; enabled: boolean }) {
  const map = useMap();

  const update = useCallback(() => {
    const left = map.getPane('before');
    const right = map.getPane('after');
    if (!left || !right) return;
    if (!enabled) {
      left.style.clip = '';
      right.style.clip = '';
      return;
    }
    const size = map.getSize();
    const nw = map.containerPointToLayerPoint([0, 0]);
    const se = map.containerPointToLayerPoint(size);
    const clipX = nw.x + size.x * ratio;
    left.style.clip = `rect(${nw.y}px, ${clipX}px, ${se.y}px, ${nw.x}px)`;
    right.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${clipX}px)`;
  }, [map, ratio, enabled]);

  useEffect(() => {
    update();
    map.on('move zoom resize', update);
    return () => {
      map.off('move zoom resize', update);
    };
  }, [map, update]);

  return null;
}

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  const key = JSON.stringify(bounds);
  useEffect(() => {
    map.fitBounds(bounds, { padding: [8, 8] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function SwipeMap({ bounds, before, after, opacity, height = 'h-[460px]', children, graticule = false }: SwipeMapProps) {
  const [ratio, setRatio] = useState(0.5);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const moveTo = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setRatio(Math.min(0.98, Math.max(0.02, (clientX - rect.left) / rect.width)));
  };

  const swipe = !!before;

  return (
    <div ref={wrapRef} className={`relative ${height} overflow-hidden select-none bg-paper-2`}>
      <MapContainer bounds={bounds} className="h-full w-full" scrollWheelZoom zoomSnap={0.25} zoomDelta={0.5}>
        <BaseLayers />
        <FitBounds bounds={bounds} />
        <Pane name="before" style={{ zIndex: 450 }}>
          {before && <ImageOverlay key={before.url} url={before.url} bounds={bounds} opacity={opacity} className="pixelated" />}
        </Pane>
        <Pane name="after" style={{ zIndex: 451 }}>
          <ImageOverlay key={after.url} url={after.url} bounds={bounds} opacity={opacity} className="pixelated" />
        </Pane>
        <PaneClipper ratio={ratio} enabled={swipe} />
        {graticule && <Graticule />}
      </MapContainer>

      {swipe && (
        <>
          {/* Etiquetas */}
          <span className="figure absolute top-3 left-14 z-[1000] bg-paper border border-rule-strong rounded-[3px] px-2 py-0.5 text-sm font-bold shadow-[var(--shadow-sheet)] pointer-events-none">
            {before.label}
          </span>
          <span className="figure absolute top-3 right-14 z-[1000] bg-paper border border-rule-strong rounded-[3px] px-2 py-0.5 text-sm font-bold shadow-[var(--shadow-sheet)] pointer-events-none">
            {after.label}
          </span>

          {/* Divisor arrastrable (fuera del contenedor de Leaflet para no mover el mapa) */}
          <div
            className="absolute top-0 bottom-0 z-[1000] w-0.5 -translate-x-1/2 bg-paper shadow-[0_0_6px_rgb(27_36_48/0.6)] pointer-events-none"
            style={{ left: `${ratio * 100}%` }}
          />
          <button
            type="button"
            aria-label="Mover divisor antes/después"
            className="absolute top-1/2 z-[1001] -translate-x-1/2 -translate-y-1/2 w-9 h-12 rounded-[4px] bg-paper text-ink border border-rule-strong shadow-[var(--shadow-lift)] flex items-center justify-center cursor-ew-resize touch-none hover:bg-white"
            style={{ left: `${ratio * 100}%` }}
            onPointerDown={e => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={e => dragging.current && moveTo(e.clientX)}
            onPointerUp={() => { dragging.current = false; }}
            onKeyDown={e => {
              if (e.key === 'ArrowLeft') setRatio(r => Math.max(0.02, r - 0.05));
              if (e.key === 'ArrowRight') setRatio(r => Math.min(0.98, r + 0.05));
            }}
          >
            <GripVertical className="w-4 h-4" />
          </button>
        </>
      )}
      {children && <div className="absolute right-3 bottom-3 z-[1000] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-4.75rem)] overflow-y-auto">{children}</div>}
    </div>
  );
}
