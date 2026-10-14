import type { ClassDef, LayerKind } from '../types';
import { RULES_DEFS } from '../lib/classes';

/** Leyenda de la capa visible; las clases siempre llevan su nombre junto al color. */
export default function MapLegend({ kind, classDefs = RULES_DEFS }: { kind: LayerKind; classDefs?: ClassDef[] }) {
  if (kind === 'rgb') {
    return <p className="text-sm text-ink-2">Color real (B04 · B03 · B02), mismo contraste para todos los años.</p>;
  }
  if (kind === 'ndvi') {
    return (
      <div className="flex items-center gap-3 text-sm text-ink-2">
        <span className="figure">−0,2</span>
        <span className="h-2.5 w-40 rounded-full bg-[linear-gradient(90deg,#a50026,#f46d43,#fee08b,#d9ef8b,#66bd63,#006837)]" aria-hidden />
        <span className="figure">0,9</span>
        <span>NDVI · transparente: nubes</span>
      </div>
    );
  }
  const main = (classDefs[0]?.label ?? 'Vegetación').toLowerCase();
  const hasUrban = classDefs.some(c => c.key === 'urban');
  // Colores del mapa de cambios: core/compare.py CHANGE_COLORS
  const items = kind === 'class'
    ? classDefs.map(c => ({ label: c.label, color: c.color }))
    : [
        { label: `Pérdida de ${main}`, color: '#b42318' },
        { label: `Ganancia de ${main}`, color: '#0d9488' },
        { label: 'Nuevo suelo / minería', color: '#f59e0b' },
        ...(hasUrban ? [{ label: 'Nueva zona urbana', color: '#475569' }] : []),
        { label: 'Otro cambio', color: '#7c3aed' },
      ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
      {items.map(i => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-[2px]" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
      <li className="text-muted">{kind === 'class' ? 'Transparente: nubes o sin datos' : 'Transparente: sin cambio'}</li>
    </ul>
  );
}
