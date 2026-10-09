import type { LayerKind } from '../types';

const CLASS_ITEMS = [
  { label: 'Vegetación', swatch: 'bg-veg' },
  { label: 'Agua', swatch: 'bg-water' },
  { label: 'Suelo / minería', swatch: 'bg-soil' },
];

const CHANGE_ITEMS = [
  { label: 'Pérdida de vegetación', swatch: 'bg-signal' },
  { label: 'Ganancia de vegetación', swatch: 'bg-gain' },
  { label: 'Nuevo suelo / minería', swatch: 'bg-newsoil' },
  { label: 'Otro cambio', swatch: 'bg-other' },
];

/** Leyenda de la capa visible; las clases siempre llevan su nombre junto al color. */
export default function MapLegend({ kind }: { kind: LayerKind }) {
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
  const items = kind === 'class' ? CLASS_ITEMS : CHANGE_ITEMS;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
      {items.map(i => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={`w-3 h-3 rounded-[2px] ${i.swatch}`} aria-hidden />
          {i.label}
        </li>
      ))}
      <li className="text-muted">{kind === 'class' ? 'Transparente: nubes o sin datos' : 'Transparente: sin cambio'}</li>
    </ul>
  );
}
