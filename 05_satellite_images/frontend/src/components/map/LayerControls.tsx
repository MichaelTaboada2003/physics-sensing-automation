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
}

export default function LayerControls({ kinds, kind, onKind, opacity, onOpacity }: LayerControlsProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex flex-wrap gap-1.5 bg-black/30 p-1 rounded-xl border border-white/5">
        {kinds.map(k => (
          <button
            key={k}
            type="button"
            onClick={() => onKind(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              kind === k ? 'bg-zinc-200 text-zinc-900' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 text-xs text-zinc-500 sm:ml-auto">
        Opacidad
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={e => onOpacity(Number(e.target.value))}
          className="w-32 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
        />
        <span className="font-mono w-9 text-zinc-400">{Math.round(opacity * 100)}%</span>
      </label>
    </div>
  );
}
