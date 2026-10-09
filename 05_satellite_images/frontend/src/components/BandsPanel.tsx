import { useState, useCallback } from 'react';
import { Download, RotateCcw, ArrowRight } from 'lucide-react';
import type { StreamLine } from '../types';
import { useProgressStream } from '../hooks/useProgressStream';
import TaskProgress from './TaskProgress';

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = '';

const BAND_ROWS: [string, string, string][] = [
  ['B02', 'Azul', '10 m'],
  ['B03', 'Verde', '10 m'],
  ['B04', 'Rojo', '10 m'],
  ['B05 – B07', 'Borde rojo: estado de la vegetación', '20 m'],
  ['B08', 'Infrarrojo cercano: biomasa', '10 m'],
  ['B11 – B12', 'Infrarrojo de onda corta: suelo y humedad', '20 m'],
  ['SCL', 'Clasificación de escena: nubes, sombras, nieve', '20 m'],
];

// ── Types ──────────────────────────────────────────────────────────────────────

type DownloadStatus = 'idle' | 'downloading' | 'done' | 'error';

interface BandsPanelProps {
  sessionId: string;
  sceneInfo: { id: string; datetime: string; cloudCover: number };
  onComplete: () => void;
  /** Se llama al terminar la descarga (la etiqueta del ejemplar se actualiza). */
  onDownloaded?: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function BandsPanel({ sessionId, sceneInfo, onComplete, onDownloaded }: BandsPanelProps) {
  const [status, setStatus] = useState<DownloadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<StreamLine[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0); // force img reload
  const [cloudFraction, setCloudFraction] = useState<number | null>(null);

  const { consume } = useProgressStream();

  const appendLog = useCallback((line: StreamLine) => {
    setLogs(prev => [...prev, line]);
  }, []);

  const handleDownload = async () => {
    setStatus('downloading');
    setProgress(0);
    setLogs([]);
    setErrorMsg(null);

    await consume(
      `${API_BASE}/download`,
      'POST',
      JSON.stringify({ session_id: sessionId }),
      // onLine — progress update
      (line) => {
        appendLog(line);
        setProgress(line.progress);
      },
      // onDone
      (line) => {
        setProgress(1);
        setStatus('done');
        setPreviewKey(k => k + 1);
        if (line.cloud_fraction !== undefined) setCloudFraction(line.cloud_fraction);
        onDownloaded?.();
      },
      // onError
      (line) => {
        setStatus('error');
        setErrorMsg(line.error ?? line.message);
      },
    );
  };

  const handleRetry = () => {
    setStatus('idle');
    setProgress(0);
    setLogs([]);
    setErrorMsg(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {status !== 'done' && (
        <div className="sheet overflow-hidden">
          <table className="data-table">
            <caption className="sr-only">Bandas que se descargan</caption>
            <thead>
              <tr>
                <th scope="col">Banda</th>
                <th scope="col">Qué mide</th>
                <th scope="col" className="!text-right">Resolución</th>
              </tr>
            </thead>
            <tbody>
              {BAND_ROWS.map(([band, what, res]) => (
                <tr key={band}>
                  <td className="figure font-bold whitespace-nowrap">{band}</td>
                  <td className="text-ink-2">{what}</td>
                  <td className="num">{res}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {status === 'idle' && (
        <button onClick={handleDownload} className="btn btn-primary">
          <Download className="w-4 h-4" />
          Descargar bandas
        </button>
      )}

      <TaskProgress
        status={status === 'downloading' ? 'running' : status}
        progress={progress}
        lines={logs}
        error={errorMsg}
        titles={{
          running: 'Descargando bandas…',
          done: 'Bandas listas en reflectancia de superficie',
          error: 'No se pudo completar la descarga',
        }}
      />

      {status === 'error' && (
        <button onClick={handleRetry} className="btn btn-secondary">
          <RotateCcw className="w-4 h-4" />
          Reintentar descarga
        </button>
      )}

      {status === 'done' && (
        <figure className="sheet overflow-hidden animate-fade-in">
          <img
            key={previewKey}
            src={`${API_BASE}/preview/truecolor?session_id=${sessionId}`}
            alt={`Color real de la escena del ${sceneInfo.datetime.slice(0, 10)}`}
            className="w-full max-h-[560px] object-contain bg-paper-2"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              setErrorMsg('No se pudo cargar la vista en color real.');
            }}
          />
          <figcaption className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-rule">
            <span className="text-sm text-ink-2">
              Color real (B04 · B03 · B02), escena del <span className="figure">{sceneInfo.datetime.slice(0, 10)}</span>
              {cloudFraction !== null && (
                <> · nubes en la zona <span className="figure">{(cloudFraction * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %</span></>
              )}
            </span>
            <button onClick={onComplete} className="btn btn-primary">
              Ver índices espectrales
              <ArrowRight className="w-4 h-4" />
            </button>
          </figcaption>
        </figure>
      )}
    </div>
  );
}
