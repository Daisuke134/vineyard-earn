// ~/vineyard/core/brain.mjs — engine picker for `vineyard run`. Per HARD RULE
// (building-effective-ai-agents.md): judgment (which market/side/size) is NEVER hardcoded here — that
// decision belongs to whoever calls `vineyard trade` with explicit params (a human operator or an LLM
// agent, exactly as hl-trade/SKILL.md instructs: "You are an intelligence; you decide."). brain.mjs's
// ONLY job is deterministic BOOKKEEPING: round-robin among the engines safe to run unattended with NO
// external params (yield = treasury rebalance, solana = franklin-trading's own internal LLM decides,
// polymarket-redeem = collect already-resolved winnings). Legitimate deterministic scheduling, not a
// trading judgment (coding-style.md: deterministic code only for tools/bookkeeping).
const AUTOMATIC_ENGINES = ['yield', 'solana', 'polymarket-redeem'];

export function pickEngine({ lastRun = {}, candidates = AUTOMATIC_ENGINES } = {}) {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (lastRun[a] || 0) - (lastRun[b] || 0))[0];
}
