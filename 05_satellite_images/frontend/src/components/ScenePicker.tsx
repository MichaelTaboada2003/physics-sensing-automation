import { useState } from 'react';
import { CheckCircle2, ImageOff, Loader2 } from 'lucide-react';
import type { SceneCandidate } from '../types';

const API_BASE = '';

interface ScenePickerProps {
  searchId: string;
  scenes: SceneCandidate[];
  selectedId: string;
  onSelect: (id: string) => void;
}

// Nubosidad dentro de la zona: el dato que decide la elección
const cloudTone = (pct: number | null) =>
  pct === null ? 'text-muted'
  : pct < 5   ? 'text-veg-ink'
  : pct < 25  ? 'text-soil'
  :             'text-signal';

function Thumb({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  return (
    <div className="relative aspect-square bg-paper-2">
      {state === 'loading' && (
        <Loader2 className="absolute inset-0 m-auto w-5 h-5 text-muted animate-spin" aria-hidden />
      )}
      {state === 'error' && (
        <span className="absolute inset-0 grid place-items-center text-sm text-muted">
          <ImageOff className="w-5 h-5" aria-label="Miniatura no disponible" />
        </span>
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
    <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3" role="radiogroup" aria-label="Escenas candidatas">
      {scenes.map((s, i) => {
        const selected = s.id === selectedId;
        return (
          <li key={s.id}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(s.id)}
              className={`group w-full text-left bg-paper rounded-[6px] overflow-hidden border transition-[border-color,box-shadow] ${
                selected
                  ? 'border-stamp shadow-[0_0_0_2px_var(--color-stamp)]'
                  : 'border-rule hover:border-rule-strong hover:shadow-[var(--shadow-sheet)]'
              }`}
            >
              <span className="relative block">
                <Thumb
                  src={`${API_BASE}/scenes/thumbnail?search_id=${searchId}&scene_id=${encodeURIComponent(s.id)}`}
                  alt={`Escena del ${s.datetime.slice(0, 10)}`}
                />
                {i === 0 && (
                  <span className="absolute top-2 left-2 text-xs font-bold bg-paper text-stamp-2 rounded-[3px] px-1.5 py-0.5 shadow-[var(--shadow-sheet)]">
                    Más despejada
                  </span>
                )}
                {selected && (
                  <CheckCircle2 className="absolute top-2 right-2 w-6 h-6 text-white fill-stamp drop-shadow" aria-hidden />
                )}
              </span>
              <span className="block px-2.5 py-2">
                <span className="figure block font-bold text-[0.9375rem]">{s.datetime.slice(0, 10)}</span>
                <span className="mt-1 flex items-baseline justify-between gap-2 text-sm">
                  <span title="Nubes, sombras y nieve dentro de tu zona (capa SCL)">
                    <span className="text-muted">Zona </span>
                    <span className={`figure font-bold ${cloudTone(s.local_cloud)}`}>
                      {s.local_cloud === null ? '—' : `${s.local_cloud.toFixed(1)}%`}
                    </span>
                  </span>
                  <span title="Nubosidad del tile completo (110 × 110 km)" className="text-muted">
                    Tile <span className="figure">{s.cloud_cover.toFixed(0)}%</span>
                  </span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
