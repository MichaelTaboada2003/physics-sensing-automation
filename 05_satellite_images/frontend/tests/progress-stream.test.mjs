import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import test from 'node:test';

// Hook puro: solo se sustituye useCallback; se conserva el parser y los fetch/readers reales.
const source = fs.readFileSync(new URL('../src/hooks/useProgressStream.ts', import.meta.url), 'utf8')
  .replace("import { useCallback } from 'react';", 'const useCallback = (fn: unknown) => fn;');
const js = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
const { useProgressStream } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const progress = '{"stage":"processing","progress":0.2,"message":"Procesando"}';
const done = '{"stage":"done","progress":1,"message":"Listo"}';
const encoder = new TextEncoder();

async function run(response) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response;
  const events = [];
  try {
    await useProgressStream().consume('/test', 'POST', '{}', l => events.push(['line', l]),
      l => events.push(['done', l]), l => events.push(['error', l]));
    return events.filter(e => e[0] !== 'line');
  } finally { globalThis.fetch = original; }
}

test('EOF prematuro termina con un error', async () => {
  const result = await run(new Response(progress + '\n'));
  assert.equal(result.length, 1); assert.equal(result[0][0], 'error');
});
test('Error de lectura termina con un error', async () => {
  let count = 0;
  const body = new ReadableStream({ pull(controller) {
    if (count++ === 0) controller.enqueue(encoder.encode(progress + '\n'));
    else controller.error(new Error('Conexión interrumpida'));
  } });
  const result = await run(new Response(body));
  assert.equal(result.length, 1); assert.equal(result[0][0], 'error');
});
test('done sin salto final termina correctamente', async () => {
  const result = await run(new Response(progress + '\n' + done));
  assert.equal(result.length, 1); assert.equal(result[0][0], 'done');
});
test('No duplica terminales aunque haya líneas posteriores', async () => {
  const result = await run(new Response(done + '\n' + progress + '\n' + done + '\n'));
  assert.equal(result.length, 1); assert.equal(result[0][0], 'done');
});
test('Error HTTP conserva el detalle del servidor', async () => {
  const result = await run(new Response(JSON.stringify({detail:'Sesión expirada'}), {status:404}));
  assert.equal(result.length, 1); assert.equal(result[0][1].message, 'Sesión expirada');
});
test('JSON malformado termina con un error', async () => {
  const result = await run(new Response('invalid\n'));
  assert.equal(result.length, 1); assert.equal(result[0][0], 'error');
});
