import { useEffect, useRef, useState } from 'react';
import { MapContainer, Polygon, Rectangle, useMap, useMapEvents } from 'react-leaflet';
import type { LatLng, LatLngBoundsExpression, LatLngExpression, Map as LeafletMap } from 'leaflet';
import { Square, Search, Loader2, Crosshair, MapPinned, Maximize2 } from 'lucide-react';
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
        pathOptions={{ stroke: false, fillColor: '#09090b', fillOpacity: 0.62 }}
      />
      <Polygon
        positions={holes}
        interactive={false}
        pathOptions={{ color: '#34d399', weight: 1.5, opacity: 0.8, fill: false }}
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
}

export default function AoiMap({ bbox, onChange }: AoiMapProps) {
  const region = useRegion();
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<BBox | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const flyTo = (b: BBox) => map?.flyToBounds(toBounds(b), { padding: [40, 40], duration: 0.8 });

  const selectPreset = (b: BBox) => {
    onChange(b);
    flyTo(b);
  };

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
        setSearchError('Lugar no encontrado en Colombia.');
        return;
      }
      const [s, n, w, e] = data[0].boundingbox.map(Number);
      map.flyToBounds([[s, w], [n, e]], { duration: 0.8, maxZoom: 13 });
    } catch {
      setSearchError('No se pudo consultar el buscador.');
    } finally {
      setSearching(false);
    }
  };

  const area = bbox ? bboxAreaKm2(bbox) : 0;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 flex gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
              }
            }}
            placeholder="Buscar lugar en Colombia (p. ej. Quibdó, Caucasia)…"
            className="flex-1 min-w-0 bg-zinc-900/60 border border-white/10 focus:border-emerald-500/50 rounded-xl px-4 py-2.5 text-sm outline-none text-zinc-200 placeholder-zinc-600"
          />
          <button
            type="button"
            onClick={handleSearch}
            className="px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl border border-white/10 transition-colors"
            aria-label="Buscar lugar"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDrawing(d => !d)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
              drawing
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-white/10'
            }`}
          >
            <Square className="w-4 h-4" />
            {drawing ? 'Arrastra en el mapa…' : 'Dibujar zona'}
          </button>
          <button
            type="button"
            onClick={showRegion}
            title="Ver todo el país"
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/10 transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
            <span className="hidden sm:inline">Colombia</span>
          </button>
          <button
            type="button"
            onClick={useView}
            title="Usar la vista actual del mapa como zona"
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/10 transition-colors"
          >
            <Crosshair className="w-4 h-4" />
            <span className="hidden sm:inline">Vista</span>
          </button>
        </div>
      </div>
      {searchError && <p className="text-xs text-red-400">{searchError}</p>}

      {/* Map */}
      <div className="relative h-[380px] rounded-xl overflow-hidden border border-white/10">
        <MapContainer
          bounds={toBounds(bbox ?? PRESETS[0].bbox)}
          boundsOptions={{ padding: [40, 40] }}
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
            <Rectangle bounds={toBounds(bbox)} pathOptions={{ color: '#10b981', weight: 2, fillOpacity: 0.08 }} />
          )}
          {draft && (
            <Rectangle bounds={toBounds(draft)} pathOptions={{ color: '#fbbf24', weight: 2, dashArray: '6 4', fillOpacity: 0.1 }} />
          )}
        </MapContainer>

        {bbox && (
          <div className="absolute left-3 bottom-3 z-[1000] bg-zinc-950/85 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-300 pointer-events-none">
            {area.toLocaleString('es-ES', { maximumFractionDigits: 0 })} km²
            {region && !bboxInRegion(bbox, region)
              ? <span className="text-red-400"> · fuera de {region.name}</span>
              : area > MAX_AREA_KM2
              ? <span className="text-red-400"> · demasiado grande (máx. {MAX_AREA_KM2.toLocaleString('es-ES')})</span>
              : area > WARN_AREA_KM2
              ? <span className="text-amber-400"> · descarga lenta</span>
              : null}
          </div>
        )}
      </div>

      {/* Presets */}
      <div>
        <p className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
          <MapPinned className="w-3 h-3" /> Zonas de ejemplo
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PRESETS.map(p => (
            <button
              key={p.name}
              type="button"
              onClick={() => selectPreset(p.bbox)}
              className="text-left bg-black/30 hover:bg-white/5 border border-white/5 rounded-xl px-3 py-2 transition-colors"
            >
              <p className="text-xs font-bold text-zinc-200 truncate">{p.name}</p>
              <p className="text-[11px] text-zinc-500 truncate">{p.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
