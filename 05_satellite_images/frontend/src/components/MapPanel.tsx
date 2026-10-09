import { useState } from 'react';
import { ArrowRight, Download, FileSpreadsheet, FileText, Image as ImageIcon, Map as MapIcon, RotateCcw } from 'lucide-react';
import type { LayerKind, Zone } from '../types';
import { useLayerBounds } from '../hooks/useLayerBounds';
import { useMapStats } from '../hooks/useMapStats';
import SwipeMap from './map/SwipeMap';
import LayerControls from './map/LayerControls';
import MapLegend from './MapLegend';
import SpecimenLabel from './SpecimenLabel';

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = '';

// ── Types ──────────────────────────────────────────────────────────────────────

interface MapPanelProps {
  sessionId: string;
  zone: Zone | null;
  sceneInfo: { id: string; datetime: string } | null;
  onReset: () => void;
  onCompare: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function MapPanel({ sessionId, zone, sceneInfo, onReset, onCompare }: MapPanelProps) {
  const [layerKind, setLayerKind] = useState<LayerKind>('class');
  const [opacity, setOpacity] = useState(0.8);
  const { bounds, error: boundsError } = useLayerBounds(sessionId);
  const stats = useMapStats(sessionId, 'map');

  const exports = [
    {
      href: `${API_BASE}/export/report.html?session_id=${sessionId}`,
      newTab: true,
      icon: FileText,
      title: 'Reporte completo',
      detail: 'Página imprimible a PDF con mapas, métricas y tablas.',
    },
    {
      href: `${API_BASE}/export/stats.csv?session_id=${sessionId}`,
      icon: FileSpreadsheet,
      title: 'Superficies por clase (CSV)',
      detail: 'Hectáreas y porcentajes, listos para una hoja de cálculo.',
    },
    {
      href: `${API_BASE}/download/classified.png?session_id=${sessionId}`,
      icon: ImageIcon,
      title: 'Mapa clasificado (PNG)',
      detail: 'Imagen con leyenda.',
    },
    {
      href: `${API_BASE}/download/classified.tif?session_id=${sessionId}`,
      icon: MapIcon,
      title: 'Mapa georreferenciado (GeoTIFF)',
      detail: 'Para abrir en QGIS o ArcGIS.',
    },
  ];

  return (
    <div className="space-y-6">
      <section className="sheet overflow-hidden" aria-label="Mapa de cobertura">
        <div className="p-3 border-b border-rule bg-paper-2 space-y-2.5">
          <LayerControls
            kinds={['class', 'ndvi', 'rgb']}
            kind={layerKind}
            onKind={setLayerKind}
            opacity={opacity}
            onOpacity={setOpacity}
          />
          <MapLegend kind={layerKind} />
        </div>
        {bounds ? (
          <SwipeMap
            bounds={bounds}
            after={{ url: `${API_BASE}/layer?session_id=${sessionId}&kind=${layerKind}`, label: 'Actual' }}
            opacity={opacity}
            height="h-[440px] lg:h-[600px]"
          >
            {zone && (
              <div className="hidden sm:block">
                <SpecimenLabel
                  zone={zone}
                  scene={sceneInfo}
                  cloudFraction={stats?.cloud_fraction}
                  classes={stats?.classes}
                />
              </div>
            )}
          </SwipeMap>
        ) : (
          <p className="p-6 text-sm text-ink-2">
            {boundsError ? 'No se pudo cargar el mapa. La sesión pudo haber expirado: vuelve al paso 1.' : 'Cargando mapa…'}
          </p>
        )}
      </section>

      {/* En móvil la etiqueta va debajo del mapa */}
      {zone && (
        <div className="sm:hidden">
          <SpecimenLabel zone={zone} scene={sceneInfo} cloudFraction={stats?.cloud_fraction} classes={stats?.classes} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        <section aria-labelledby="exports-title">
          <h2 id="exports-title" className="font-serif text-xl font-semibold mb-3">Exportar</h2>
          <ul className="sheet divide-y divide-rule">
            {exports.map(e => (
              <li key={e.title}>
                <a
                  href={e.href}
                  {...(e.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : { download: '' })}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-paper-2 transition-colors group"
                >
                  <e.icon className="w-5 h-5 text-ink-2 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    <span className="block font-semibold group-hover:text-stamp-2">{e.title}</span>
                    <span className="block text-sm text-muted">{e.detail}</span>
                  </span>
                  <Download className="w-4 h-4 ml-auto text-muted shrink-0" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="sheet p-4 space-y-3" aria-labelledby="next-title">
          <h2 id="next-title" className="font-serif text-xl font-semibold">¿Qué cambió en esta zona?</h2>
          <p className="text-sm text-ink-2">
            Compara este mapa con cualquier año de la última década o calcula la serie completa con sus tendencias.
          </p>
          <button onClick={onCompare} className="btn btn-primary w-full">
            Comparar con años anteriores
            <ArrowRight className="w-4 h-4" />
          </button>
          <button onClick={onReset} className="btn btn-quiet w-full">
            <RotateCcw className="w-4 h-4" />
            Empezar un análisis nuevo
          </button>
        </section>
      </div>
    </div>
  );
}
