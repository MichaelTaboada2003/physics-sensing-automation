import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import test from 'node:test';

// Reductor puro de la matriz de avance (sin dependencias de React)
const source = fs.readFileSync(new URL('../src/lib/yearProgress.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
const { applyYearEvent, emptyYearProgress, sceneCount } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

const plan = { plan: { years: [2024, 2025], cached: [2023], scenes_per_year: 3, current_year: 2025 } };

test('el plan crea una fila por año y marca los ya calculados', () => {
  const p = applyYearEvent(emptyYearProgress(1), plan);
  assert.equal(p.scenesPerYear, 3);
  assert.deepEqual(p.rows.map(r => [r.year, r.state]), [[2023, 'cached'], [2024, 'pending'], [2025, 'pending']]);
  assert.deepEqual(sceneCount(p), { done: 0, total: 6 });
});

test('las escenas avanzan y el año listo trae su cifra', () => {
  let p = applyYearEvent(emptyYearProgress(1), plan);
  p = applyYearEvent(p, { year: 2024, scenes_total: 2 });
  p = applyYearEvent(p, { year: 2024, scene_index: 1, scenes_total: 2 });
  assert.deepEqual(p.rows[1], { year: 2024, total: 2, done: 1, state: 'running' });
  assert.deepEqual(sceneCount(p), { done: 1, total: 5 });
  p = applyYearEvent(p, { year: 2024, year_done: true, n_scenes: 2, primary_percent: 51.3 });
  assert.equal(p.rows[1].state, 'done');
  assert.equal(p.rows[1].percent, 51.3);
});

test('un año sin imágenes no suma escenas previstas', () => {
  let p = applyYearEvent(emptyYearProgress(1), plan);
  p = applyYearEvent(p, { year: 2025, year_failed: true });
  assert.equal(p.rows[2].state, 'failed');
  assert.deepEqual(sceneCount(p), { done: 0, total: 3 });
});

test('una línea sin evento no cambia el estado', () => {
  const p = applyYearEvent(emptyYearProgress(1), plan);
  assert.equal(applyYearEvent(p, undefined), p);
  assert.equal(applyYearEvent(p, {}), p);
});

test('un año fuera del plan se añade en orden', () => {
  let p = applyYearEvent(emptyYearProgress(6), { year: 2020, scenes_total: 6 });
  p = applyYearEvent(p, { year: 2019, scene_index: 1, scenes_total: 6 });
  assert.deepEqual(p.rows.map(r => r.year), [2019, 2020]);
});
