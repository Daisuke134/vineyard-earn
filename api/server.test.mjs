// ~/vineyard/api/server.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_API_KEY = 'test-only-key-do-not-use-in-prod';
process.env.VINEYARD_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-api-test-home-'));
process.env.VINEYARD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-api-test-data-'));
process.env.VINEYARD_API_KEY = TEST_API_KEY;

const { default: app } = await import('../api/server.mjs');

async function listen() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test('POST /fund without an Authorization header returns 401 and never reaches the engine', async () => {
  const { server, baseUrl } = await listen();
  try {
    const res = await fetch(`${baseUrl}/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'no-auth-attempt', amount: 5 }),
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  } finally {
    server.close();
  }
});

test('POST /fund with a wrong bearer token also returns 401 (constant-time comparison rejects a length/content mismatch)', async () => {
  const { server, baseUrl } = await listen();
  try {
    const res = await fetch(`${baseUrl}/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-the-right-key' },
      body: JSON.stringify({ id: 'wrong-key-attempt', amount: 5 }),
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('POST /fund with the CORRECT bearer token passes the auth gate (routing test only — no engine is dependency-injected into api/server.mjs, so this proves auth success via the route\'s own existing 404-unspawned-id branch, never a real subprocess call)', async () => {
  const { server, baseUrl } = await listen();
  try {
    const res = await fetch(`${baseUrl}/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_API_KEY}` },
      body: JSON.stringify({ id: 'no-wallet-for-this-id', amount: 5 }),
    });
    // resolveEvmPrivateKey returns null for an unspawned id, so the route's existing fail-closed 404
    // branch fires WITHOUT ever calling polymarketEngine.fund — this proves the request got PAST the
    // auth gate (401 would mean auth blocked it; 404 proves auth passed and real route logic ran).
    assert.notEqual(res.status, 401);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('POST /spawn, GET /list, GET /status/:id remain accessible with NO auth header (deliberate scope — only money-moving routes are gated, REQ-020)', async () => {
  const { server, baseUrl } = await listen();
  try {
    const spawnRes = await fetch(`${baseUrl}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(spawnRes.status, 201);
    const spawned = await spawnRes.json();

    const listRes = await fetch(`${baseUrl}/list`);
    assert.equal(listRes.status, 200);

    const statusRes = await fetch(`${baseUrl}/status/${spawned.id}`);
    assert.equal(statusRes.status, 200);
  } finally {
    server.close();
  }
});

test('POST /spawn with a path-traversal id is rejected 400, not a crash or a written file (REQ-019/FIND-005 at the API level)', async () => {
  const { server, baseUrl } = await listen();
  try {
    const res = await fetch(`${baseUrl}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '../../tmp/evil' }),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid instance id' });
  } finally {
    server.close();
  }
});
