import { useEffect, useRef, useState } from 'react';
import { MapContainer, Polygon, Rectangle, useMap, useMapEvents } from 'react-leaflet';
import type { LatLng, LatLngBoundsExpression, LatLngExpression, Map as LeafletMap } from 'leaflet';
import { Square, Search, Loader2, Crosshair, Maximize2 } from 'lucide-react';
import type { BBox } from '../../types';
import { MAX_AREA_KM2, PRESETS, WARN_AREA_KM2, bboxAreaKm2, bboxInRegion } from '../../lib/geo';
import type { Region } from '../../lib/geo';
import { useRegion } from '../../hooks/useRegion';
import BaseLayers from './basemaps';

const toBounds = ([w, s, e, n]: BBox): LatLngBoundsExpression => [[s, w], [n, e]];

const round = (v: number) => Math.round(v * 10_000) / 10_000;

function fromCorners(a: LatLng, b: LatLng): BBox {
  return [
    round(Math.min(a.lng, b.lng)), round(Math.min(a.lat, b.lat)),
    round(Math.max(a.lng, b.lng)), round(Math.max(a.lat, b.lat)),
  ];
}

// ── Dibujo de rectángulo ───────────────────────────────────────────────────────

function DrawHandler({
  active,
  onDraft,
  onDone,
}: {
  active: boolean;
  onDraft: (b: BBox | null) => void;
  onDone: (b: BBox) => void;
}) {
  const start = useRef<LatLng | null>(null);
  const map = useMapEvents({
    mousedown(e) {
      if (!active) return;
      start.current = e.latlng;
    },
    mousemove(e) {
      if (active && start.current) onDraft(fromCorners(start.current, e.latlng));
    },
    mouseup(e) {
      if (!active || !start.current) return;
      const b = fromCorners(start.current, e.latlng);
      start.current = null;
      onDraft(null);
      if (b[2] - b[0] > 0.001 && b[3] - b[1] > 0.001) onDone(b);
    },
  });

  useEffect(() => {
    const container = map.getContainer();
    if (active) {
      map.dragging.disable();
      container.classList.add('aoi-drawing');
    } else {
      map.dragging.enable();
      container.classList.remove('aoi-drawing');
    }
  }, [active, map]);

  return null;
}

// ── Foco en la región (Colombia) ───────────────────────────────────────────────

const WORLD: LatLngExpression[] = [[-89, -179.9], [89, -179.9], [89, 179.9], [-89, 179.9]];
const toLatLngs = (ring: [number, number][]): LatLngExpression[] => ring.map(([lon, lat]) => [lat, lon]);

function RegionFocus({ region }: { region: Region }) {
  const map = useMap();
  useEffect(() => {
    const [w, s, e, n] = region.bounds;
    const bounds: LatLngBoundsExpression = [[s, w], [n, e]];
    map.setMinZoom(Math.max(3, map.getBoundsZoom(bounds) - 1));
    // Margen de 2° para poder ver zonas fronterizas sin salir del país
    map.setMaxBounds([[s - 2, w - 2], [n + 2, e + 2]]);
  }, [map, region]);

  const holes = region.rings.map(toLatLngs);
  return (
    <>
      {/* Todo lo que no es Colombia queda oscurecido */}
      <Polygon
        positions={[WORLD, ...holes]}
        interactive={false}
        pathOptions={{ stroke: false, fillColor: '#1b2430', fillOpacity: 0.55 }}
      />
      <Polygon
        positions={holes}
        interactive={false}
        pathOptions={{ color: '#fbfcf8', weight: 1.5, opacity: 0.9, fill: false }}
      />
    </>
  );
}

function MapRefSetter({ onMap }: { onMap: (m: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => onMap(map), [map, onMap]);
  return null;
}

// ── Componente ─────────────────────────────────────────────────────────────────

interface AoiMapProps {
  bbox: BBox | null;
  onChange: (bbox: BBox) => void;
  /** Pide volar a una zona elegida fuera del mapa; `n` cambia en cada petición. */
  focus?: { bbox: BBox; n: number };
  /** Alto del mapa (clases de Tailwind). */
  heightClass?: string;
  /** Contenido superpuesto en la esquina inferior derecha (p. ej. la etiqueta). */
  children?: React.ReactNode;
}

export default function AoiMap({ bbox, onChange, focus, heightClass = 'h-[420px] lg:h-[560px]', children }: AoiMapProps) {
  const region = useRegion();
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<BBox | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Volar a la zona elegida desde fuera del mapa (zonas de ejemplo)
  const focusN = focus?.n;
  useEffect(() => {
    if (!map || !focus) return;
    map.flyToBounds(toBounds(focus.bbox), { padding: [48, 48], duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focusN]);

  const showRegion = () => {
    if (!map || !region) return;
    const [w, s, e, n] = region.bounds;
    map.flyToBounds([[s, w], [n, e]], { duration: 0.8 });
  };

  const useView = () => {
    if (!map) return;
    const v = map.getBounds();
    onChange(fromCorners(v.getSouthWest(), v.getNorthEast()));
  };

  // Sin <form>: este mapa vive dentro del formulario de búsqueda de escenas
  const handleSearch = async () => {
    if (!query.trim() || !map) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=co&q=${encodeURIComponent(query)}`,
        { headers: { 'Accept-Language': 'es' } },
      );
      const data: { boundingbox: [string, string, string, string] }[] = await res.json();
      if (!data.length) {
        setSearchError(`No encontramos «${query}» en Colombia. Prueba con un municipio o departamento.`);
        return;
      }
      const [s, n, w, e] = data[0].boundingbox.map(Number);
      map.flyToBounds([[s, w], [n, e]], { duration: 0.8, maxZoom: 13 });
    } catch {
      setSearchError('El buscador de lugares no respondió. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setSearching(false);
    }
  };

  const area = bbox ? bboxAreaKm2(bbox) : 0;
  const outside = !!(bbox && region && !bboxInRegion(bbox, region));

  return (
    <div className="sheet overflow-hidden">
      {/* Barra de herramientas */}
      <div className="flex flex-col sm:flex-row gap-2 p-2 border-b border-rule bg-paper-2">
        <div className="flex-1 flex gap-2 min-w-0">
          <label className="sr-only" htmlFor="place-search">Buscar lugar</label>
          <input
            id="place-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
              }
            }}
            placeholder="Buscar municipio o lugar…"
            className="field flex-1 min-w-0"
          />
          <button type="button" onClick={handleSearch} className="btn btn-secondary px-3" aria-label="Buscar lugar">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDrawing(d => !d)}
            aria-pressed={drawing}
            className={`btn flex-1 sm:flex-none ${drawing ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Square className="w-4 h-4" />
            {drawing ? 'Arrastra sobre el mapa' : 'Dibujar zona'}
          </button>
          <button type="button" onClick={showRegion} title="Ver todo el país" className="btn btn-secondary px-3">
            <Maximize2 className="w-4 h-4" />
            <span className="hidden xl:inline">Colombia</span>
          </button>
          <button type="button" onClick={useView} title="Usar la vista actual como zona" className="btn btn-secondary px-3">
            <Crosshair className="w-4 h-4" />
            <span className="hidden xl:inline">Usar vista</span>
          </button>
        </div>
      </div>
      {searchError && <p className="px-3 py-2 text-sm text-signal border-b border-rule">{searchError}</p>}

      {/* Mapa */}
      <div className={`relative ${heightClass}`}>
        <MapContainer
          bounds={toBounds(bbox ?? PRESETS[0].bbox)}
          boundsOptions={{ padding: [48, 48] }}
          maxBoundsViscosity={1.0}
          className="h-full w-full"
          scrollWheelZoom
        >
          <BaseLayers />
          {region && <RegionFocus region={region} />}
          <MapRefSetter onMap={setMap} />
          <DrawHandler
            active={drawing}
            onDraft={setDraft}
            onDone={b => { onChange(b); setDrawing(false); }}
          />
          {bbox && !draft && (
            <Rectangle
              bounds={toBounds(bbox)}
              pathOptions={{ color: outside ? '#b42318' : '#fbfcf8', weight: 2, fillColor: '#5a4a9c', fillOpacity: 0.12 }}
            />
          )}
          {draft && (
            <Rectangle bounds={toBounds(draft)} pathOptions={{ color: '#fbfcf8', weight: 2, dashArray: '6 4', fillOpacity: 0.08 }} />
          )}
        </MapContainer>

        {bbox && (
          <p
            className={`absolute left-3 bottom-3 z-[1000] sheet px-2.5 py-1 text-sm shadow-[var(--shadow-sheet)] pointer-events-none ${
              // Con la etiqueta visible el área ya se lee ahí: el aviso solo aparece si hay problema
              children && !outside && area <= WARN_AREA_KM2 ? 'sm:hidden' : ''
            }`}
          >
            <span className="figure">{area.toLocaleString('es-CO', { maximumFractionDigits: 0 })} km²</span>
            {outside
              ? <span className="text-signal font-semibold"> · fuera de {region?.name}</span>
              : area > MAX_AREA_KM2
              ? <span className="text-signal font-semibold"> · supera {MAX_AREA_KM2.toLocaleString('es-CO')} km²</span>
              : area > WARN_AREA_KM2
              ? <span className="text-ink-2"> · la descarga tardará más</span>
              : null}
          </p>
        )}
        {children && <div className="absolute right-3 bottom-3 z-[1000] max-w-[calc(100%-1.5rem)]">{children}</div>}
      </div>
    </div>
  );
}
