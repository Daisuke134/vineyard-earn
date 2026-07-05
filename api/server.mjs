// ~/vineyard/api/server.mjs — Express REST, same verbs as the CLI (spec §4).
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { generateWallet, isValidId, resolveEvmPrivateKey } from '../core/wallet.mjs';
import { registerSpawn, readRegistry, findSpawn, updateSpawn } from '../core/registry.mjs';
import { runOnce } from '../core/loop.mjs';
import { readLedger, realizedPnl } from '../core/ledger.mjs';
import * as yieldEngine from '../engines/yield.mjs';
import * as polymarketEngine from '../engines/polymarket.mjs';
import * as hyperliquidEngine from '../engines/hyperliquid.mjs';
import * as solanaEngine from '../engines/solana.mjs';

const ENGINES = { yield: yieldEngine, solana: solanaEngine, polymarket: polymarketEngine };
const DATA_DIR = process.env.VINEYARD_DATA_DIR || path.resolve('data');

const app = express();
app.use(express.json());

// REQ-019/FIND-005: `id` is caller-controlled and is used as a filesystem path segment inside
// core/wallet.mjs's instanceDir()/core/ledger.mjs's ledgerPath() — both now throw for an invalid id.
// Several routes below are ASYNC Express 4 handlers; a synchronous throw inside an async handler
// becomes an UNHANDLED PROMISE REJECTION (Express 4 does not await/catch a handler's returned
// promise) rather than a clean HTTP error — left unguarded this would be a new crash/DoS vector
// introduced by the id-validation fix itself. This middleware validates `id` up front, BEFORE any
// handler runs, so an invalid id always returns a clean 400 and never reaches a throwing function.
function requireValidId(req, res, next) {
  const id = req.body?.id ?? req.params?.id;
  if (id !== undefined && !isValidId(id)) {
    return res.status(400).json({ error: 'invalid instance id' });
  }
  next();
}

// REQ-020/FIND-006: money-moving routes (/fund, /trade, /redeem) require this bearer token. There is
// intentionally NO default — an unset VINEYARD_API_KEY refuses to start the server at all (below),
// so a deployment can never accidentally go live unauthenticated.
const API_KEY = process.env.VINEYARD_API_KEY;

// REQ-020/FIND-006: constant-time comparison — `===` on the raw header would be a timing
// side-channel on the key itself. Falls back to `false` (never throws) on a length mismatch, since
// crypto.timingSafeEqual() requires equal-length buffers.
function requireApiKey(req, res, next) {
  const header = req.headers.authorization || '';
  const expected = `Bearer ${API_KEY}`;
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  const authorized = headerBuf.length === expectedBuf.length && crypto.timingSafeEqual(headerBuf, expectedBuf);
  if (!authorized) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.post('/spawn', requireValidId, (req, res) => {
  const id = req.body?.id || crypto.randomBytes(4).toString('hex');
  // body.key/body.solanaKey are the ONLY bring-your-own-key path (REQ-003) — id-scoped, spawn-time
  // only. generateWallet() silently ignores these if wallet.json/solana.json already exists for `id`.
  const wallet = generateWallet(id, process.env, { evmPrivateKey: req.body?.key, solanaSecretKey: req.body?.solanaKey });
  const row = registerSpawn({
    id,
    evm: wallet.evm.address,
    solana: wallet.solana.address,
    fund: Number(req.body?.fund || 0),
    engine: req.body?.engine || null,
  });
  res.status(201).json(row);
});

app.get('/list', (_req, res) => {
  res.json(readRegistry());
});

app.get('/status/:id', requireValidId, (req, res) => {
  const row = findSpawn(req.params.id);
  if (!row) return res.status(404).json({ error: 'unknown id' });
  res.json(row);
});

// requireApiKey gates ONLY /fund, /trade, /redeem — the real money-moving verbs (REQ-020/FIND-006).
// /run and /status/:id/full stay unauthenticated by the same deliberate ease-of-onboarding scope as
// /spawn/list/status (REQ-020) — /run only invokes the read-only-safe automatic engines (yield/
// solana/polymarket-redeem, never a hardcoded trade side/size), and /status/:id/full only reads.
app.post('/fund', requireApiKey, requireValidId, async (req, res) => {
  const { id, amount, sourceKey } = req.body || {};
  const pk = resolveEvmPrivateKey(id);
  if (!pk) return res.status(404).json({ error: `no wallet for id ${id}` });
  const result = await polymarketEngine.fund({ evmPrivateKey: pk, sourceKey, fundUsd: Number(amount || 2) });
  // D8: registering the deposit wallet here is what lets a later POST /redeem (and core/loop.mjs's
  // polymarket-redeem branch) find it via findSpawn(id).polymarketDepositWallet.
  if (result.registered) updateSpawn(id, { polymarketDepositWallet: result.deposit_wallet });
  res.json(result);
});

app.post('/run', requireValidId, async (req, res) => {
  const { id, engine } = req.body || {};
  const line = await runOnce({ id, dataDir: DATA_DIR, engines: ENGINES, candidates: engine ? [engine] : undefined });
  res.json(line);
});

app.get('/status/:id/full', requireValidId, (req, res) => {
  const spawn = findSpawn(req.params.id);
  if (!spawn) return res.status(404).json({ error: 'unknown id' });
  res.json({ ...spawn, realized_pnl_usdc: realizedPnl(req.params.id, DATA_DIR), ledger: readLedger(req.params.id, DATA_DIR) });
});

app.post('/trade', requireApiKey, requireValidId, async (req, res) => {
  // WHICH market/side/size to trade is the caller's decision (a human operator or an LLM agent
  // reading this API's own contract), NEVER hardcoded here — per building-effective-ai-agents.md and
  // hl.py's own philosophy ("You are an intelligence; you decide"). This route only executes.
  const { id, engine, ...params } = req.body || {};
  const pk = resolveEvmPrivateKey(id);
  if (!pk) return res.status(404).json({ error: `no wallet for id ${id}` });
  let result;
  if (engine === 'hl') {
    result = await hyperliquidEngine.open({ ...params, evmPrivateKey: pk });
  } else if (engine === 'pm') {
    result = await polymarketEngine.trade({ evmPrivateKey: pk, tokenId: params.tokenId, side: params.side, amountUsd: params.amountUsd, maxPrice: params.maxPrice });
  } else {
    return res.status(400).json({ error: 'engine must be hl or pm' });
  }
  res.json(result);
});

app.post('/redeem', requireApiKey, requireValidId, async (req, res) => {
  const { id } = req.body || {};
  const spawn = findSpawn(id);
  const pk = resolveEvmPrivateKey(id);
  if (!pk) return res.status(404).json({ error: `no wallet for id ${id}` });
  if (!spawn?.polymarketDepositWallet) return res.status(404).json({ error: `no known Polymarket deposit wallet for id ${id} — call POST /fund first` });
  const result = await polymarketEngine.redeem({ evmPrivateKey: pk, depositWallet: spawn.polymarketDepositWallet });
  res.json(result);
});

const PORT = process.env.PORT || 3000;
if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  // REQ-020/FIND-006: fail-closed by design — a deployment must not go live with real-money routes
  // (/fund, /trade, /redeem) unauthenticated. /spawn, /list, /status stay deliberately unauthenticated
  // (see REQ-020) so this refusal is solely about the money-moving surface, not the whole server.
  if (!API_KEY) {
    console.error('VINEYARD_API_KEY is not set — refusing to start the API server with money-moving routes unauthenticated');
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`vineyard API listening on :${PORT}`));
}

export default app;
