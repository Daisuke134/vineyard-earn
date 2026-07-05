# Vineyard

**AI financial independence, machine-readable.** `git clone` + one command → spawn a self-funded AI
instance: it owns its own EVM + Solana wallet, with per-instance key isolation so no instance can ever
sign or spend with another instance's key. Built for the YC RFS "Software for Agents" (Aaron Epstein):
an agent-first, machine-readable earning layer — CLI + REST API + `llms.txt`, no MCP required.

Every "hundreds of AI agents earning" story starts here: an agent that can be born with its own money,
with no human touching its keys. Vineyard spawns instances, hands each one its own isolated wallet, and
lets it earn across four on-chain engines — Polymarket, yield (Aave/Beefy/Fluid), Hyperliquid, and
Solana — with no human and no chat session in the loop after the one-time seed.

**Live dashboard**: [vineyard-dashboard-production.up.railway.app](https://vineyard-dashboard-production.up.railway.app)
— every spawned instance's wallets and real realized P&L, updated from the actual host state.

## Quickstart

```bash
git clone https://github.com/Daisuke134/vineyard-earn && cd vineyard-earn
npm install
python3 -m venv engines/python/.venv
engines/python/.venv/bin/pip install -r engines/python/requirements.txt

node cli/index.mjs spawn --fund 10   # spawns an instance: own EVM + Solana wallet, prints its address
node cli/index.mjs list              # shows every spawned instance
```

Example output of `spawn` (real, captured from a fresh instance):

```json
{
  "id": "a286552c",
  "evm": "0xb1a6f2ad1c5412Aed58AE3E7E4F232D33662fF8B",
  "solana": "4oW6ZiRv5AQVpLUTnWHyPKsUpDZqppBsHZmNSGEfeJHE",
  "fund": 10,
  "engine": null,
  "created": "2026-07-05T07:40:10.126Z"
}
```

By default state lives under `~/.vineyard/` (override with `VINEYARD_HOME=/path`).

## Commands

CLI and REST API expose the same verbs (identical semantics — see `llms.txt` + `openapi.json` for the
full machine-readable contract):

| CLI | HTTP | What it does |
|---|---|---|
| `vineyard spawn [--fund N] [--key 0x...] [--solana-key ...]` | `POST /spawn` | Create an instance: its own isolated EVM + Solana wallet |
| `vineyard list` | `GET /list` | Every spawned instance's public metadata (addresses only, never key material) |
| `vineyard fund <id> <amount> [--source-key <key>]` | `POST /fund` (auth required) | Register + fund the instance's Polymarket deposit wallet through the bridge onramp |
| `vineyard run <id> [--engine <name>]` | `POST /run` | One pass of the automatic earn loop (rotates among yield / solana / polymarket-redeem unless `--engine` pins one) — returns one real ledger line |
| `vineyard status <id>` | `GET /status/:id` (summary) `GET /status/:id/full` (+ realized P&L + ledger) | Wallet addresses, realized P&L, full ledger history |
| `vineyard trade <id> --engine <hl\|pm> ...` | `POST /trade` (auth required) | One manual, explicit trade — side/size/params are supplied by the caller; this CLI/API never picks a side itself |
| `vineyard redeem <id>` | `POST /redeem` (auth required) | Collect resolved Polymarket winnings |

`vineyard run <id>` output (real, captured against a freshly spawned, as-yet-unfunded instance — an
honest abort, not a fabricated success):

```json
{
  "ts": "2026-07-05T08:13:07.024Z",
  "id": "61e734ce",
  "engine": "yield",
  "status": "abort",
  "abort": "no ETH for gas",
  "wallet": "0x69bCD4b4bc9446959A7167577209C49E1216e986"
}
```

`/fund`, `/trade`, `/redeem` move real money and require `Authorization: Bearer $VINEYARD_API_KEY`
(`.env.example` — the API server refuses to start at all if that key isn't set). `/spawn`, `/list`,
`/status`, `/run` stay unauthenticated by design.

## First-time setup — the one human touch-point

1. Run `vineyard spawn --fund <amount>` — this prints the instance's own EVM address. Send USDC there.
2. Polymarket registration needs `--source-key` (env `SOURCE_KEY`) from an ALREADY-REGISTERED
   Polymarket wallet for the very first bootstrap (a brand-new deployment has no prior registered
   wallet to draw from — this is the one human-provided seed the architecture accounts for). Onboard
   your own wallet once at polymarket.com, then pass its key: `vineyard fund <id> 5 --source-key 0x...`.
3. The Hyperliquid engine needs its own funded account (USDC via the Arbitrum bridge — see
   `engines/python/hyperliquid/hl.py`'s docstring).
4. The Solana engine wraps the `franklin-trading` CLI, which manages its own wallet under this
   instance's own isolated `$HOME` — run `franklin-trading setup solana` once per instance (see
   `engines/solana.mjs`'s `setup()`) and fund the address it prints.

## Why key isolation is the point

An AI that earns money needs its own wallet. An AI that earns money **safely, at scale — hundreds of
instances — needs a wallet that structurally cannot leak into another instance's hands.** That's the
one property Vineyard is built around first, before any trading logic: `core/wallet.mjs`'s
`resolveEvmPrivateKey(id)`/`resolveSolanaSecret(id)` read ONLY the file scoped to `id`, never a shared or
ambient credential, and `instanceDir(id)` validates `id` before it ever touches the filesystem — a
fail-closed boundary covered by an adversarial test suite (`npm test`).

## Money-safety invariants

- Per-instance key isolation: every spawned instance has its own EVM + Solana wallet under
  `<VINEYARD_HOME>/instances/<id>/`; the resolver fails closed (returns `null`, never a foreign key) for
  any id it hasn't generated a wallet for.
- Never a raw pUSD transfer to a Polymarket deposit wallet — always through the bridge Collateral
  Onramp (`engines/python/polymarket/fund_via_bridge.py`), the only way the CLOB relayer registers it.
- On-chain-verified earnings only — `core/ledger.mjs` records realized, tx-verified P&L, never paper.
- No dry run — every `run`/`trade`/`redeem` is a real pass against real on-chain state; a `skip`/
  `abort`/`wait` result is an honest outcome, never fabricated.
- `id` is validated against a safe filesystem-path pattern before it ever reaches a path segment
  (`core/wallet.mjs`'s `isValidId`/`instanceDir`, reused by `core/ledger.mjs`'s `ledgerPath`) — an
  unsafe id is rejected before any filesystem write, never used to write outside
  `<VINEYARD_HOME>/instances/` or `data/ledgers/`.
- `/fund`, `/trade`, `/redeem` require `Authorization: Bearer $VINEYARD_API_KEY`; the API refuses to
  start at all if that key isn't set.

## The four engines

| Engine | What it does |
|---|---|
| Polymarket | Registers a deposit wallet through the bridge onramp, places CLOB V2 FAK orders, redeems resolved winnings automatically |
| Yield | Deposits idle USDC into Aave / Beefy / Fluid on Base, keeps a liquid compute buffer, refills it from yield when it runs low |
| Hyperliquid | Perp primitives (account/market/open/close) — a hard stop, take-profit, and capped leverage; the caller decides side/size |
| Solana | Wraps the `franklin-trading` CLI, an autonomous LLM-driven trading agent with its own wallet, isolated per instance via `$HOME` |

Each engine is a thin Node wrapper around a vendored, proven Python/shell implementation
(`engines/python/`, `engines/shell/`) — the money-safety logic (deposit-wallet registry gate, neg-risk
approvals, CTF operator approval, read-after-write deposit proof) is invoked, never reimplemented.
`core/brain.mjs` picks which of the three **automatic** engines (yield / solana / polymarket-redeem)
runs on `vineyard run` by simple round-robin bookkeeping — it never hardcodes a market, side, or size;
that judgment belongs to whoever calls `vineyard trade` with explicit parameters.

## Architecture

```
cli/  +  api/        same verbs, CLI and REST
   |
core/                wallet isolation · spawn registry · ledger · engine picker · wake→pick→earn→ledger loop
   |
engines/              thin Node wrappers → engines/python/ (Polymarket, Hyperliquid) + engines/shell/ (Solana)
```

## Interface

CLI + REST API + `llms.txt`, so another agent can spawn, fund, and monitor Vineyard instances
programmatically — no MCP server required. Full machine-readable contract: `llms.txt` + `openapi.json`.

## License

MIT.
