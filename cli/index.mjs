#!/usr/bin/env node
// ~/vineyard/cli/index.mjs — `vineyard <cmd>` dispatcher (spec §4).
import crypto from 'node:crypto';
import path from 'node:path';
import { generateWallet, resolveEvmPrivateKey } from '../core/wallet.mjs';
import { registerSpawn, readRegistry, findSpawn, updateSpawn } from '../core/registry.mjs';
import { runOnce } from '../core/loop.mjs';
import { readLedger, realizedPnl } from '../core/ledger.mjs';
import * as yieldEngine from '../engines/yield.mjs';
import * as polymarketEngine from '../engines/polymarket.mjs';
import * as hyperliquidEngine from '../engines/hyperliquid.mjs';
import * as solanaEngine from '../engines/solana.mjs';

const ENGINES = { yield: yieldEngine, solana: solanaEngine, polymarket: polymarketEngine };
// VINEYARD_DATA_DIR ONLY (no VINEYARD_HOME-derived fallback path — that would silently point ledgers
// at a DIFFERENT directory than what core/wallet.mjs's own instanceDir()/vineyardHome() resolve to
// unless the two env vars happen to be kept in sync by the caller). Defaults to ./data, matching the
// repo's own data/ledgers/ layout (Task 1's file-structure diagram).
const DATA_DIR = process.env.VINEYARD_DATA_DIR || path.resolve('data');

const [, , cmd, ...rest] = process.argv;

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function cmdSpawn(args) {
  const { flags } = parseFlags(args);
  const id = flags.id || newId();
  // --key/--solana-key are the ONLY bring-your-own-key path (REQ-003) — id-scoped, spawn-time only.
  // generateWallet() silently ignores these if wallet.json/solana.json already exists for `id`.
  // REQ-019/FIND-005: an invalid --id (e.g. containing "../") makes instanceDir() throw inside
  // generateWallet() below — that throw propagates up through this async function to main()'s
  // top-level `.catch()` (bottom of this file), which already prints the message to stderr and sets
  // a non-zero exit code, so an invalid --id is a clean, documented CLI failure, never an unhandled
  // crash — no separate try/catch is needed here.
  const wallet = generateWallet(id, process.env, { evmPrivateKey: flags.key, solanaSecretKey: flags['solana-key'] });
  const row = registerSpawn({
    id,
    evm: wallet.evm.address,
    solana: wallet.solana.address,
    fund: Number(flags.fund || 0),
    engine: flags.engine || null,
  });
  console.log(JSON.stringify(row, null, 2));
  return row;
}

async function cmdList() {
  console.log(JSON.stringify(readRegistry(), null, 2));
}

async function main() {
  switch (cmd) {
    case 'spawn':
      await cmdSpawn(rest);
      break;
    case 'list':
      await cmdList();
      break;
    case 'fund': {
      const { flags, positional } = parseFlags(rest);
      const [id, amount] = positional;
      const pk = resolveEvmPrivateKey(id);
      if (!pk) { console.error(`no wallet for id ${id} — spawn it first`); process.exitCode = 1; break; }
      const result = await polymarketEngine.fund({ evmPrivateKey: pk, sourceKey: flags['source-key'], fundUsd: Number(amount || flags.fund || 2) });
      // D8: registering the deposit wallet here is what lets a later `vineyard redeem <id>` (and
      // core/loop.mjs's polymarket-redeem branch) find it via findSpawn(id).polymarketDepositWallet.
      if (result.registered) updateSpawn(id, { polymarketDepositWallet: result.deposit_wallet });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'run': {
      const { flags, positional } = parseFlags(rest);
      const [id] = positional;
      const line = await runOnce({ id, dataDir: DATA_DIR, engines: ENGINES, candidates: flags.engine ? [flags.engine] : undefined });
      console.log(JSON.stringify(line, null, 2));
      break;
    }
    case 'status': {
      const [id] = rest;
      const spawn = findSpawn(id);
      if (!spawn) { console.error(`unknown id: ${id}`); process.exitCode = 1; break; }
      console.log(JSON.stringify({ ...spawn, realized_pnl_usdc: realizedPnl(id, DATA_DIR), ledger: readLedger(id, DATA_DIR) }, null, 2));
      break;
    }
    case 'trade': {
      // WHICH market/side/size to trade is the caller's decision (a human operator or an LLM agent
      // reading this tool's own contract), NEVER hardcoded here — per building-effective-ai-agents.md
      // and hl.py's own philosophy ("You are an intelligence; you decide"). This verb only executes.
      const { flags, positional } = parseFlags(rest);
      const [id] = positional;
      const pk = resolveEvmPrivateKey(id);
      if (!pk) { console.error(`no wallet for id ${id} — spawn it first`); process.exitCode = 1; break; }
      let result;
      if (flags.engine === 'hl') {
        result = await hyperliquidEngine.open({ coin: flags.coin, side: flags.side, notional: Number(flags.notional), lev: Number(flags.lev || 2), sl: Number(flags.sl || 4), tp: Number(flags.tp || 8), evmPrivateKey: pk });
      } else if (flags.engine === 'pm') {
        result = await polymarketEngine.trade({ evmPrivateKey: pk, tokenId: flags['token-id'], side: flags.side, amountUsd: Number(flags.amount), maxPrice: Number(flags['max-price']) });
      } else {
        console.error('usage: vineyard trade <id> --engine <hl|pm> ...'); process.exitCode = 2; break;
      }
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'redeem': {
      const [id] = rest;
      const spawn = findSpawn(id);
      const pk = resolveEvmPrivateKey(id);
      if (!pk) { console.error(`no wallet for id ${id} — spawn it first`); process.exitCode = 1; break; }
      if (!spawn?.polymarketDepositWallet) { console.error(`no known Polymarket deposit wallet for id ${id} — run 'vineyard fund' first`); process.exitCode = 1; break; }
      const result = await polymarketEngine.redeem({ evmPrivateKey: pk, depositWallet: spawn.polymarketDepositWallet });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'dashboard': {
      console.log('Web App UI is a separate follow-up (spec TODO item G) — run `npm run api` for the REST surface for now.');
      break;
    }
    default:
      console.error('usage: vineyard <spawn|fund|run|status|list|trade|redeem|dashboard> [...args]');
      process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exitCode = 1;
});
