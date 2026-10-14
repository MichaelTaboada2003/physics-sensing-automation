import type { ClassDef } from '../types';

// Esquema del método de reglas: respaldo cuando una respuesta antigua no trae clases
export const RULES_DEFS: ClassDef[] = [
  { code: 0, key: 'vegetation', label: 'Vegetación', color: '#16a34a' },
  { code: 1, key: 'water', label: 'Agua', color: '#2563eb' },
  { code: 2, key: 'mining', label: 'Suelo expuesto / minería', color: '#b45309' },
];

/** Color para líneas de gráfico: el verde claro de pastos no llega a 3:1 sobre papel. */
export const chartColor = (c: ClassDef) => (c.key === 'grass' ? '#65a30d' : c.color);

/** Nombre con artículo para frases: «la vegetación», «el bosque»… */
const PHRASES: Record<string, string> = {
  vegetation: 'la vegetación',
  forest: 'el bosque',
  water: 'el agua',
  mining: 'el suelo expuesto o minería',
  urban: 'el área urbana',
  grass: 'los pastos y cultivos',
};
export const phrase = (c: ClassDef) => PHRASES[c.key] ?? c.label.toLowerCase();

/** «de» + frase con la contracción del español: «del bosque», «de la vegetación». */
export const dePhrase = (c: ClassDef) => {
  const p = phrase(c);
  return p.startsWith('el ') ? `del ${p.slice(3)}` : `de ${p}`;
};

/** Clases que resumen una ficha de determinación (la principal primero). */
export function slipDefs(defs: ClassDef[]): ClassDef[] {
  const pick = defs.some(d => d.key === 'forest') ? ['forest', 'grass', 'urban'] : ['vegetation', 'water', 'mining'];
  return pick.map(k => defs.find(d => d.key === k)).filter((d): d is ClassDef => !!d);
}
