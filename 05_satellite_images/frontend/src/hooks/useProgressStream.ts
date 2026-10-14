import { useCallback } from 'react';
import type { StreamLine } from '../types';

const SILENCE_TIMEOUT_MS = 30_000;

/** Un stream siempre termina en exactamente un callback: done o error. */
export function useProgressStream() {
  const consume = useCallback(async (
    url: string,
    method: 'GET' | 'POST',
    body: BodyInit | null,
    onLine: (line: StreamLine) => void,
    onDone: (line: StreamLine) => void,
    onError: (line: StreamLine) => void,
  ): Promise<void> => {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (line: StreamLine) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (line.stage === 'done') onDone(line);
      else onError(line);
    };
    const fail = (message: string) => finish({ stage: 'error', progress: 0, message, error: message });
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fail('Conexión interrumpida: sin datos durante 30 segundos. Puedes reintentar.');
        controller.abort();
      }, SILENCE_TIMEOUT_MS);
    };
    const parse = (raw: string) => {
      if (!raw.trim() || settled) return;
      const line = JSON.parse(raw) as StreamLine;
      if (typeof line.stage !== 'string' || typeof line.message !== 'string' || typeof line.progress !== 'number') {
        throw new Error('Formato de progreso no válido.');
      }
      onLine(line);
      if (line.stage === 'done' || line.stage === 'error') finish(line);
    };
    try {
      resetTimer(); // también cubre una conexión que nunca devuelve cabeceras
      const response = await fetch(url, {
        method, headers: body !== null ? { 'Content-Type': 'application/json' } : {}, body, signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        fail(typeof payload?.detail === 'string' ? payload.detail : `Error del servidor (HTTP ${response.status}).`);
        return;
      }
      if (!response.body) { fail('El servidor devolvió una respuesta vacía.'); return; }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!settled) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          parse(buffer);
          if (!settled) fail('La conexión terminó antes de completar el análisis. Puedes reintentar.');
          break;
        }
        resetTimer();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const raw of lines) parse(raw);
      }
    } catch (err: unknown) {
      fail(err instanceof Error ? err.message : 'Error de red al recibir el análisis.');
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }, []);
  return { consume };
}
