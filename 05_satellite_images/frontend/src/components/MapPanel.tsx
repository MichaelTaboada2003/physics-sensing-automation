import { useState } from 'react';
import type { LayerKind } from '../types';
import { useLayerBounds } from '../hooks/useLayerBounds';
import SwipeMap from './map/SwipeMap';
import LayerControls from './map/LayerControls';
import {
  Map,
  Download,
  RefreshCw,
  AlertCircle,
  Loader2,
  Leaf,
  Droplets,
  Mountain,
  HelpCircle,
  History,
  Globe,
  FileText,
  FileSpreadsheet,
} from 'lucide-react';

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = '';

// ── Types ──────────────────────────────────────────────────────────────────────

interface MapPanelProps {
  sessionId: string;
  onReset: () => void;
  onCompare: () => void;
}

type ImageStatus = 'loading' | 'loaded' | 'error';

// ── Legend items ───────────────────────────────────────────────────────────────

const LEGEND_ITEMS = [
  { label: 'Vegetación',            color: 'bg-green-600',      icon: Leaf,       textColor: 'text-green-400'  },
  { label: 'Agua',                  color: 'bg-blue-600',       icon: Droplets,   textColor: 'text-blue-400'   },
  { label: 'Minería / Suelo exp.',  color: 'bg-amber-800',      icon: Mountain,   textColor: 'text-amber-500'  },
  { label: 'Sin datos / nube',       color: 'bg-zinc-900',       icon: HelpCircle, textColor: 'text-zinc-500'   },
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function MapPanel({ sessionId, onReset, onCompare }: MapPanelProps) {
  const [imageStatus, setImageStatus] = useState<ImageStatus>('loading');
  const [layerKind, setLayerKind] = useState<LayerKind>('class');
  const [opacity, setOpacity] = useState(0.75);
  const { bounds } = useLayerBounds(sessionId);

  const mapUrl      = `${API_BASE}/map/classified?session_id=${sessionId}`;
  const pngUrl      = `${API_BASE}/download/classified.png?session_id=${sessionId}`;
  const geotiffUrl  = `${API_BASE}/download/classified.tif?session_id=${sessionId}`;

  // ── Download helpers ──────────────────────────────────────────────────────────

  const handleDownload = (url: string, filename: string) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-3xl mx-auto animate-fade-in space-y-6">

      {/* ── Interactive map ── */}
      {bounds && (
        <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-500/10 rounded-lg border border-teal-500/20">
              <Globe className="w-4 h-4 text-teal-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-200">Sobre el mapa</h3>
              <p className="text-xs text-zinc-500">Capa georreferenciada superpuesta a la imagen satelital de alta resolución</p>
            </div>
          </div>
          <LayerControls
            kinds={['class', 'ndvi', 'rgb']}
            kind={layerKind}
            onKind={setLayerKind}
            opacity={opacity}
            onOpacity={setOpacity}
          />
          <SwipeMap
            bounds={bounds}
            after={{ url: `${API_BASE}/layer?session_id=${sessionId}&kind=${layerKind}`, label: 'Actual' }}
            opacity={opacity}
          />
        </div>
      )}

      {/* ── Map image ── */}
      <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-teal-500/10 rounded-lg border border-teal-500/20">
            <Map className="w-4 h-4 text-teal-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-200">Mapa de clasificación</h3>
            <p className="text-xs text-zinc-500">Renderizado con leyenda integrada por el servidor</p>
          </div>
        </div>

        {/* Image container */}
        <div className="relative w-full rounded-xl overflow-hidden border border-white/5 bg-black/30 min-h-[300px] flex items-center justify-center">
          {/* Loading spinner */}
          {imageStatus === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
              <p className="text-xs text-zinc-500 font-medium">Cargando mapa…</p>
            </div>
          )}

          {/* Error state */}
          {imageStatus === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 px-6 text-center">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-red-400 font-medium">
                No se pudo cargar el mapa clasificado.
              </p>
              <p className="text-xs text-zinc-500">
                Asegúrate de que la predicción se completó correctamente y que la sesión sigue activa.
              </p>
              <button
                onClick={() => setImageStatus('loading')}
                className="mt-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-xl border border-white/10 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-3 h-3" />
                Reintentar
              </button>
            </div>
          )}

          {/* Map image — always rendered so onLoad/onError fire */}
          <img
            key={sessionId}
            src={mapUrl}
            alt="Mapa de clasificación de cobertura terrestre"
            className={`w-full h-auto rounded-xl transition-opacity duration-500 ${
              imageStatus === 'loaded' ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={() => setImageStatus('loaded')}
            onError={() => setImageStatus('error')}
          />
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6">
        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">
          Leyenda de clases
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {LEGEND_ITEMS.map(({ label, color, icon: Icon, textColor }) => (
            <div
              key={label}
              className="flex items-center gap-2 bg-black/20 rounded-xl px-3 py-2.5 border border-white/5"
            >
              <span className={`w-3 h-3 rounded-sm flex-shrink-0 ${color} border border-white/10`} />
              <Icon className={`w-3 h-3 flex-shrink-0 ${textColor}`} />
              <span className="text-[11px] font-medium text-zinc-300 leading-tight">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Download buttons ── */}
      <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
            <Download className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-200">Exportar mapa</h3>
            <p className="text-xs text-zinc-500">Reporte imprimible, tabla de superficies, PNG o GeoTIFF georreferenciado</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Full report */}
          <a
            href={`${API_BASE}/export/report.html?session_id=${sessionId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 py-3 px-4 bg-zinc-100 hover:bg-white text-zinc-900 font-bold text-sm rounded-xl transition-all active:scale-[0.98]"
          >
            <FileText className="w-4 h-4" />
            Reporte completo (HTML / PDF)
          </a>

          {/* Stats CSV */}
          <button
            onClick={() => handleDownload(`${API_BASE}/export/stats.csv?session_id=${sessionId}`, 'superficie_por_clase.csv')}
            className="flex items-center justify-center gap-2 py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-sm rounded-xl border border-white/10 transition-all active:scale-[0.98]"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Superficies (CSV)
          </button>

          {/* Download PNG */}
          <button
            onClick={() => handleDownload(pngUrl, 'mapa_clasificacion.png')}
            className="flex items-center justify-center gap-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-600/20 transition-all active:scale-[0.98]"
          >
            <Download className="w-4 h-4" />
            Descargar PNG
          </button>

          {/* Download GeoTIFF */}
          <button
            onClick={() => handleDownload(geotiffUrl, 'mapa_clasificacion.tif')}
            className="flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-600/20 transition-all active:scale-[0.98]"
          >
            <Download className="w-4 h-4" />
            Descargar GeoTIFF
          </button>
        </div>
      </div>

      {/* ── Temporal comparison ── */}
      <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-zinc-200">Comparativa temporal</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Compara este mapa con la misma zona hasta 10 años atrás.
            </p>
          </div>
          <button
            onClick={onCompare}
            className="flex items-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-orange-600/20 transition-all active:scale-[0.98] flex-shrink-0"
          >
            <History className="w-4 h-4" />
            Comparar años
          </button>
        </div>
      </div>

      {/* ── New analysis button ── */}
      <div className="bg-zinc-900/40 rounded-2xl border border-white/5 p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-zinc-200">¿Nuevo análisis?</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Reinicia la aplicación y vuelve al paso 1 para configurar una nueva consulta.
            </p>
          </div>
          <button
            onClick={onReset}
            className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 font-bold text-sm rounded-xl border border-white/10 transition-all active:scale-[0.98] flex-shrink-0"
          >
            <RefreshCw className="w-4 h-4" />
            Nuevo análisis
          </button>
        </div>
      </div>

    </div>
  );
}
