// ~/vineyard/core/registry.mjs — spawns.json CRUD. Public-safe metadata only, never key material.
// SECURITY (REQ-019): unlike core/wallet.mjs's instanceDir()-scoped functions, nothing here builds a
// filesystem path FROM `id` — every row lives inside the ONE shared vineyardHome()/spawns.json file,
// so an unsafe `id` string cannot cause a path-traversal write here. `id`-format safety for the
// FILESYSTEM is still enforced upstream: every caller (cli/index.mjs's cmdSpawn, api/server.mjs's
// POST /spawn) always calls generateWallet()/instanceDir() BEFORE registerSpawn(), so an invalid id
// is already rejected before registerSpawn ever runs.
import fs from 'node:fs';
import path from 'node:path';
import { vineyardHome } from './wallet.mjs';

function registryPath(env = process.env) {
  return path.join(vineyardHome(env), 'spawns.json');
}

export function readRegistry(env = process.env) {
  try {
    return JSON.parse(fs.readFileSync(registryPath(env), 'utf8'));
  } catch {
    return [];
  }
}

function writeRegistry(rows, env = process.env) {
  const p = registryPath(env);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(rows, null, 2));
}

export function registerSpawn({ id, evm, solana, fund = 0, engine = null }, env = process.env) {
  const rows = readRegistry(env);
  if (rows.some((r) => r.id === id)) {
    throw new Error(`instance id already registered: ${id}`);
  }
  const row = { id, evm, solana, fund, engine, created: new Date().toISOString() };
  writeRegistry([...rows, row], env);
  return row;
}

export function findSpawn(id, env = process.env) {
  return readRegistry(env).find((r) => r.id === id) || null;
}

export function updateSpawn(id, patch, env = process.env) {
  const rows = readRegistry(env);
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error(`instance id not found: ${id}`);
  rows[idx] = { ...rows[idx], ...patch };
  writeRegistry(rows, env);
  return rows[idx];
}
