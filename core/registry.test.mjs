// ~/vineyard/core/registry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerSpawn, readRegistry, findSpawn } from './registry.mjs';

function tmpEnv(prefix) {
  return { VINEYARD_HOME: fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`)) };
}

test('readRegistry: empty when no spawns.json exists yet', () => {
  const env = tmpEnv('vy-reg-empty');
  assert.deepEqual(readRegistry(env), []);
});

test('registerSpawn: adds a row and readRegistry sees it', () => {
  const env = tmpEnv('vy-reg-add');
  const row = registerSpawn({ id: 'x1', evm: '0xabc', solana: 'Sol111', fund: 0, engine: null }, env);
  assert.equal(row.id, 'x1');
  assert.ok(row.created);
  const rows = readRegistry(env);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'x1');
});

test('registerSpawn: rejects a duplicate id', () => {
  const env = tmpEnv('vy-reg-dup');
  registerSpawn({ id: 'dup', evm: '0x1', solana: 'S1' }, env);
  assert.throws(() => registerSpawn({ id: 'dup', evm: '0x2', solana: 'S2' }, env), /already registered/);
});

test('findSpawn: returns null for an unknown id', () => {
  const env = tmpEnv('vy-reg-find-none');
  assert.equal(findSpawn('nope', env), null);
});

test('findSpawn: returns the matching row', () => {
  const env = tmpEnv('vy-reg-find');
  registerSpawn({ id: 'y1', evm: '0xdef', solana: 'Sol222' }, env);
  const found = findSpawn('y1', env);
  assert.equal(found.evm, '0xdef');
});
