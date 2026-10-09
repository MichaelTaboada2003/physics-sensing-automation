import { useState } from 'react';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = '';

// ── Types ──────────────────────────────────────────────────────────────────────

type IndexName = 'ndvi' | 'bsi' | 'ndwi' | 'mndwi' | 'ndbi' | 'evi' | 'savi';

interface IndicesPanelProps {
  sessionId: string;
  sceneInfo: { id: string; datetime: string; cloudCover: number };
  onComplete: () => void;
}

// ── Index metadata ─────────────────────────────────────────────────────────────
// `reading` describe la rampa de color que pinta el backend (core/indices.py).

const INDICES: { name: IndexName; label: string; title: string; formula: string; reading: string }[] = [
  {
    name: 'ndvi', label: 'NDVI', title: 'Índice de vegetación de diferencia normalizada',
    formula: '(B08 − B04) / (B08 + B04)',
    reading: 'Verde: vegetación densa. Amarillo: pastos o cultivos. Rojo: suelo, agua o construcciones.',
  },
  {
    name: 'bsi', label: 'BSI', title: 'Índice de suelo desnudo',
    formula: '((B11 + B04) − (B08 + B02)) / ((B11 + B04) + (B08 + B02))',
    reading: 'Marrón oscuro: suelo desnudo o minería. Amarillo claro: superficies cubiertas.',
  },
  {
    name: 'ndwi', label: 'NDWI', title: 'Índice de agua de diferencia normalizada',
    formula: '(B03 − B08) / (B03 + B08)',
    reading: 'Azul intenso: agua abierta. Claro: tierra firme.',
  },
  {
    name: 'mndwi', label: 'MNDWI', title: 'Índice de agua modificado',
    formula: '(B03 − B11) / (B03 + B11)',
    reading: 'Azul: agua. Separa mejor el agua de techos y suelo urbano que el NDWI.',
  },
  {
    name: 'ndbi', label: 'NDBI', title: 'Índice de áreas construidas',
    formula: '(B11 − B08) / (B11 + B08)',
    reading: 'Rojo: construcciones o suelo seco. Claro: vegetación y agua.',
  },
  {
    name: 'evi', label: 'EVI', title: 'Índice de vegetación mejorado',
    formula: '2.5 (B08 − B04) / (B08 + 6 B04 − 7.5 B02 + 1)',
    reading: 'Verde intenso: bosque denso. No se satura donde el NDVI ya está al máximo.',
  },
  {
    name: 'savi', label: 'SAVI', title: 'Índice de vegetación ajustado al suelo',
    formula: '1.5 (B08 − B04) / (B08 + B04 + 0.5)',
    reading: 'Verde azulado: vegetación. Marrón: suelo. Corrige el brillo del suelo donde hay poca vegetación.',
  },
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function IndicesPanel({ sessionId, sceneInfo, onComplete }: IndicesPanelProps) {
  const [activeIndex, setActiveIndex] = useState<IndexName>('ndvi');
  const [indexLoadError, setIndexLoadError] = useState<string | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [trueColorError, setTrueColorError] = useState<string | null>(null);

  const meta = INDICES.find(i => i.name === activeIndex)!;

  const handleSelectIndex = (name: IndexName) => {
    if (name === activeIndex) return;
    setActiveIndex(name);
    setIndexLoadError(null);
    setIndexLoading(true);
  };

  return (
    <div className="space-y-5">
      <div className="segmented" role="tablist" aria-label="Índice espectral">
        {INDICES.map(idx => (
          <button
            key={idx.name}
            role="tab"
            aria-selected={activeIndex === idx.name}
            aria-controls="index-panel"
            onClick={() => handleSelectIndex(idx.name)}
            className="figure"
          >
            {idx.label}
          </button>
        ))}
      </div>

      <div id="index-panel" role="tabpanel" className="space-y-4">
        <div className="max-w-[70ch]">
          <h2 className="font-serif text-xl font-semibold">{meta.title}</h2>
          <p className="text-ink-2 mt-1">{meta.reading}</p>
          <p className="text-sm text-muted mt-1">
            <span className="figure">{meta.label} = {meta.formula}</span>
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <figure className="sheet overflow-hidden flex flex-col">
            <div className="flex-1 grid place-items-center bg-paper-2 min-h-[280px]">
              {trueColorError ? (
                <p className="flex items-center gap-2 p-6 text-sm text-signal">
                  <AlertCircle className="w-4 h-4" /> {trueColorError}
                </p>
              ) : (
                <img
                  src={`${API_BASE}/preview/truecolor?session_id=${sessionId}`}
                  alt={`Color real de la escena del ${sceneInfo.datetime.slice(0, 10)}`}
                  className="w-full h-full object-contain max-h-[480px]"
                  onError={() => setTrueColorError('No se pudo cargar la imagen en color real.')}
                />
              )}
            </div>
            <figcaption className="px-4 py-2.5 border-t border-rule text-sm text-ink-2">
              Color real · <span className="figure">{sceneInfo.datetime.slice(0, 10)}</span>
            </figcaption>
          </figure>

          <figure className="sheet overflow-hidden flex flex-col">
            <div className="relative flex-1 grid place-items-center bg-white min-h-[280px]">
              {indexLoading && !indexLoadError && (
                <Loader2 className="absolute w-6 h-6 text-stamp animate-spin" aria-label="Calculando índice" />
              )}
              {indexLoadError ? (
                <p className="flex items-center gap-2 p-6 text-sm text-signal">
                  <AlertCircle className="w-4 h-4" /> {indexLoadError}
                </p>
              ) : (
                <img
                  key={`${activeIndex}-${sessionId}`}
                  src={`${API_BASE}/index/${activeIndex}?session_id=${sessionId}`}
                  alt={`${meta.label}: ${meta.reading}`}
                  className={`w-full h-full object-contain max-h-[480px] transition-opacity ${indexLoading ? 'opacity-30' : 'opacity-100'}`}
                  onLoad={() => setIndexLoading(false)}
                  onError={() => {
                    setIndexLoading(false);
                    setIndexLoadError(`No se pudo calcular el ${meta.label}. Vuelve a descargar las bandas si la sesión expiró.`);
                  }}
                />
              )}
            </div>
            <figcaption className="px-4 py-2.5 border-t border-rule text-sm text-ink-2">
              {meta.label} · gris: nubes o sin datos
            </figcaption>
          </figure>
        </div>
      </div>

      <button onClick={onComplete} className="btn btn-primary">
        Clasificar la cobertura
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
