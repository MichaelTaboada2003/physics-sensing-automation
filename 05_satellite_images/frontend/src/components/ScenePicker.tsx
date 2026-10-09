import { useState } from 'react';
import { Cloud, CloudOff, CheckCircle2, ImageOff, Loader2 } from 'lucide-react';
import type { SceneCandidate } from '../types';

const API_BASE = '';

interface ScenePickerProps {
  searchId: string;
  scenes: SceneCandidate[];
  selectedId: string;
  onSelect: (id: string) => void;
}

// Color del indicador de nubes dentro de la zona
const cloudTone = (pct: number | null) =>
  pct === null ? 'text-zinc-500 bg-zinc-800/80'
  : pct < 5   ? 'text-emerald-300 bg-emerald-500/20'
  : pct < 25  ? 'text-amber-300 bg-amber-500/20'
  :             'text-red-300 bg-red-500/20';

function Thumb({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  return (
    <div className="relative aspect-square bg-black/40">
      {state === 'loading' && (
        <Loader2 className="absolute inset-0 m-auto w-5 h-5 text-zinc-600 animate-spin" />
      )}
      {state === 'error' && (
        <ImageOff className="absolute inset-0 m-auto w-5 h-5 text-zinc-600" />
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setState('ok')}
        onError={() => setState('error')}
        className={`w-full h-full object-cover transition-opacity duration-300 ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}

export default function ScenePicker({ searchId, scenes, selectedId, onSelect }: ScenePickerProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {scenes.map((s, i) => {
        const selected = s.id === selectedId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            className={`relative text-left rounded-xl overflow-hidden border transition-all ${
              selected
                ? 'border-emerald-400 ring-2 ring-emerald-400/40'
                : 'border-white/10 hover:border-white/30'
            }`}
          >
            <Thumb
              src={`${API_BASE}/scenes/thumbnail?search_id=${searchId}&scene_id=${encodeURIComponent(s.id)}`}
              alt={`Escena del ${s.datetime.slice(0, 10)}`}
            />
            {i === 0 && (
              <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wider bg-emerald-600 text-white rounded-md px-1.5 py-0.5">
                Recomendada
              </span>
            )}
            {selected && <CheckCircle2 className="absolute top-2 right-2 w-5 h-5 text-emerald-400 drop-shadow" />}
            <div className="p-2.5 bg-zinc-950/80 space-y-1.5">
              <p className="text-sm font-mono font-bold text-zinc-200">{s.datetime.slice(0, 10)}</p>
              <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                <span
                  title="Nubes, sombras y nieve dentro de tu zona (capa SCL)"
                  className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 ${cloudTone(s.local_cloud)}`}
                >
                  <CloudOff className="w-3 h-3" />
                  {s.local_cloud === null ? '—' : `${s.local_cloud.toFixed(1)} %`}
                </span>
                <span
                  title="Nubosidad del tile completo (110 × 110 km)"
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-400 bg-zinc-800/80"
                >
                  <Cloud className="w-3 h-3" />
                  {s.cloud_cover.toFixed(0)} %
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
