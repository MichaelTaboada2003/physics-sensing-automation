import { Grid3x3 } from 'lucide-react';
import type { LayerKind } from '../../types';

const KIND_LABELS: Record<LayerKind, string> = {
  class: 'Clasificación',
  rgb: 'Color real',
  ndvi: 'NDVI',
  change: 'Cambios',
};

interface LayerControlsProps {
  kinds: LayerKind[];
  kind: LayerKind;
  onKind: (k: LayerKind) => void;
  opacity: number;
  onOpacity: (v: number) => void;
  graticule?: boolean;
  onGraticule?: (v: boolean) => void;
}

export default function LayerControls({ kinds, kind, onKind, opacity, onOpacity, graticule, onGraticule }: LayerControlsProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="segmented" role="group" aria-label="Capa del mapa">
        {kinds.map(k => (
          <button key={k} type="button" onClick={() => onKind(k)} aria-pressed={kind === k}>
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      {onGraticule && (
        <button
          type="button"
          onClick={() => onGraticule(!graticule)}
          aria-pressed={!!graticule}
          className={`btn !min-h-9 px-3 text-sm ${graticule ? 'btn-primary' : 'btn-secondary'}`}
        >
          <Grid3x3 className="w-4 h-4" /> Retícula
        </button>
      )}
      <label className="flex items-center gap-3 text-sm text-ink-2 sm:ml-auto">
        Opacidad
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={e => onOpacity(Number(e.target.value))}
          className="w-32"
        />
        <span className="figure w-14 text-right whitespace-nowrap">{Math.round(opacity * 100)} %</span>
      </label>
    </div>
  );
}
