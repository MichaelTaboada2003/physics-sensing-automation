import type { Trend } from '../types';

const fmtP = (p: number) =>
  p < 0.001 ? '< 0,001' : `= ${p.toLocaleString('es-CO', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;

/**
 * Filtro de tinta desigual para los sellos. Se monta una sola vez (App):
 * desplaza el borde con ruido y recorta zonas mal entintadas.
 */
export function StampInk() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <filter id="ink-bleed" x="-6%" y="-12%" width="112%" height="124%">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="grain" />
        <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.3" result="edge" />
        <feTurbulence type="fractalNoise" baseFrequency="0.03 0.07" numOctaves="2" seed="9" result="blot" />
        <feColorMatrix in="blot" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.5" result="ink" />
        <feComposite in="edge" in2="ink" operator="in" />
      </filter>
    </svg>
  );
}

interface StampProps {
  trend: Trend;
  /** Periodo de la serie, p. ej. «2016–2025». */
  span?: string;
  /** Versión reducida para la etiqueta del ejemplar. */
  small?: boolean;
  /** Anima la caída del sello (solo al llegar a los resultados). */
  press?: boolean;
  className?: string;
}

/**
 * Veredicto de Mann-Kendall como sello de determinación. El texto dice lo mismo
 * que el color: rojo solo si la tendencia es estadísticamente significativa.
 */
export default function Stamp({ trend, span, small = false, press = false, className = '' }: StampProps) {
  return (
    <p
      className={`stamp ${small ? 'stamp-sm' : ''} ${press ? 'stamp-press' : ''} ${className}`}
      data-significant={trend.significant}
    >
      <b>{trend.significant ? 'Tendencia significativa' : 'Sin tendencia significativa'}</b>
      <span>
        Mann-Kendall p <span className="figure">{fmtP(trend.p_value)}</span>
        {span && <> · <span className="figure">{span}</span></>}
      </span>
    </p>
  );
}
