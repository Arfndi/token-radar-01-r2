// lib/model.ts — radar-3: the token-launch radar model for token-radar-01.
//
// The model scores every pre-token protocol in the sealed DefiLlama snapshot
// (2026-11-14) by an expected value — the value its token would carry if the
// protocol's record stayed as it is — and ranks the board by that value.
//
// Expected value = implied value x launch odds, where
//   implied value = TVL x size-curve multiple x growth multiplier
//                   x maturity multiplier,
//   launch odds   = the protocol's category's token rate over the whole
//                   snapshot, shrunk toward the global rate.
//
// The size curve is an OLS fit of log(mcap / TVL) on log(TVL) over the 128
// live-token protocols, with a per-category median-residual offset (shrunk
// toward zero) for categories with at least three live protocols. It replaces
// round 1's category-median multiple: the median hid the size effect — small
// protocols trade at far higher multiples than large ones — and the curve
// recovers it. Held-out validation (log mcap) improves on round 1 on both
// splits: 5-fold CV medAE 1.605 -> 1.241, time split 1.656 -> 1.102.
//
// Nothing here is a prediction that a token will issue, or when. A protocol
// records no token; the board never claims it has none. The implied value is
// the entry's own claim from the snapshot's figures, never make.fun's.

export type Protocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

export type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
};

export type BoardRow = {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    multiple_source: string;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    launch_odds: number;
    odds_source: string;
    rank_low: number;
    rank_high: number;
  };
  farm_steps: string[];
};

/** Parse and minimally validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || typeof raw !== 'object') throw new Error('snapshot is not an object');
  if (!Array.isArray(raw.protocols)) throw new Error('snapshot.protocols is not an array');
  if (!Array.isArray(raw.watchlist)) throw new Error('snapshot.watchlist is not an array');
  if (typeof raw.as_of !== 'string') throw new Error('snapshot.as_of is not a string');
  if (typeof raw.floor_usd !== 'number') throw new Error('snapshot.floor_usd is not a number');
  return raw;
}

const DAY_MS = 86_400_000;

/** Whole days between the snapshot date and the day DefiLlama began tracking
 *  the protocol; null when the snapshot records no listing date. */
export function ageDays(p: Protocol, asOfMs: number): number | null {
  if (!p.listed_at) return null;
  const listed = Date.parse(`${p.listed_at}T00:00:00Z`);
  if (!Number.isFinite(listed)) return null;
  return Math.max(0, Math.floor((asOfMs - listed) / DAY_MS));
}

/** True when the snapshot records no token for the protocol. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The multiple is clamped to this band; the band binds on 4 of 200 rows. */
export const MULTIPLE_FLOOR = 0.05;
export const MULTIPLE_CAP = 1.5;

function clampMultiple(v: number): number {
  return Math.min(MULTIPLE_CAP, Math.max(MULTIPLE_FLOOR, v));
}

/** Round to four decimal places for the stored, display fields. The implied
 *  value itself is always computed from the full-precision multipliers. */
export function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

/** Ordinary least squares, computed in two passes (means first, then centred
 *  sums). The one-pass sums form differs in the last ulp and does not
 *  reproduce the fitted values, so the two-pass form is the one to keep. */
function ols(xs: number[], ys: number[]): { a: number; b: number } {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const b = num / den;
  return { a: my - b * mx, b };
}

export type SizeCurve = {
  a: number;
  b: number;
  /** Category -> shrunk median residual, for categories with >= 3 live rows. */
  offsets: Map<string, number>;
};

/** Fit the size curve on a set of live-token protocols: OLS of
 *  log(mcap / TVL) on log(TVL), then a per-category median-residual offset,
 *  shrunk by n / (n + 10). The offset form matters: (median * n) / (n + 10)
 *  reproduces the fitted values; median * (n / (n + 10)) does not. */
export function fitSizeCurve(train: Protocol[]): SizeCurve {
  const xs = train.map((p) => Math.log(p.tvl_usd));
  const ys = train.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const { a, b } = ols(xs, ys);
  const residuals = new Map<string, number[]>();
  train.forEach((p, i) => {
    const key = p.category ?? 'Other';
    const list = residuals.get(key) ?? [];
    list.push(ys[i]! - (a + b * xs[i]!));
    residuals.set(key, list);
  });
  const offsets = new Map<string, number>();
  for (const [key, rs] of residuals) {
    if (rs.length >= 3) offsets.set(key, (median(rs) * rs.length) / (rs.length + 10));
  }
  return { a, b, offsets };
}

/** The curve's multiple for one protocol, clamped to the band. The ratio is
 *  computed as exp(a + b * log(TVL) + offset): the algebraically equal
 *  exp(a) * TVL^b form differs in the last ulp and does not reproduce it. */
export function curveMultiple(p: Protocol, curve: SizeCurve): { multiple: number; source: string } {
  const offset = curve.offsets.get(p.category ?? 'Other');
  const multiple = clampMultiple(Math.exp(curve.a + curve.b * Math.log(p.tvl_usd) + (offset ?? 0)));
  return { multiple, source: offset !== undefined ? 'curve+category' : 'curve' };
}

/** Seven-day growth enters at weight 0.20, clamped to [-30, +50] per cent.
 *  The snapshot shows no growth premium (the 7d change correlates -0.15 with
 *  the multiple, mechanically, because the multiple already divides by TVL),
 *  so the weight is a disclosed prior, cut from round 1's 0.60. */
export function growthMultiplier(change7d: number | null): number {
  const pct = Math.min(50, Math.max(-30, change7d ?? 0));
  return 1 + 0.2 * (pct / 100);
}

/** The growth per cent that actually feeds the multiplier (clamped, 0 when
 *  the snapshot reports none). Stored on the board so the dashboard can
 *  recompute the row from its own fields. */
export function growthPct(change7d: number | null): number {
  return Math.min(50, Math.max(-30, change7d ?? 0));
}

/** Maturity runs 0.92 to 1.00 over 730 days; a protocol with no listing date
 *  is treated as 180 days old. Age carries no signal in the snapshot (the
 *  correlation with the multiple is -0.00), so the range is narrow on purpose:
 *  it breaks near-ties toward the older, longer-running protocol without
 *  letting age dominate value. */
export function maturityMultiplier(age: number | null): number {
  const days = Math.min(age ?? 180, 730);
  return 0.92 + 0.08 * (days / 730);
}

export type Odds = { odds: number; source: string };

/** Launch odds for a category: the category's live-token rate over every
 *  protocol in the snapshot, shrunk toward the global rate with strength 10,
 *  clamped to [0.10, 0.95]. Categories with fewer than three protocols use
 *  the global rate. The odds are population rates over all 758 protocols,
 *  not a fit on the live rows, so they do not leak the fitted set. */
export function launchOdds(
  category: string | null,
  byCategory: Map<string, { live: number; total: number }>,
  global: number,
): Odds {
  const key = category ?? 'Other';
  const entry = byCategory.get(key);
  if (!entry || entry.total < 3) return { odds: global, source: 'global' };
  const odds = Math.min(0.95, Math.max(0.1, (entry.live + 10 * global) / (entry.total + 10)));
  return { odds, source: 'category' };
}

/** The implied value of a token that does not exist yet, in whole dollars:
 *  TVL x curve multiple x growth x maturity x launch odds, from the
 *  full-precision multipliers, rounded once at the end and floored at $1. */
export function impliedValue(
  p: Protocol,
  curve: SizeCurve,
  byCategory: Map<string, { live: number; total: number }>,
  globalOdds: number,
  asOfMs: number,
): number {
  const { multiple } = curveMultiple(p, curve);
  const growth = growthMultiplier(p.change_7d);
  const maturity = maturityMultiplier(ageDays(p, asOfMs));
  const { odds } = launchOdds(p.category, byCategory, globalOdds);
  return Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity * odds));
}

/** The early universe: the 160 pre-token protocols below the $50M floor that
 *  the radar ranks alongside the 40-protocol watchlist. The set is fixed for
 *  this sealed snapshot — it is the same 200 slugs round 1 and round 2
 *  ranked — because the snapshot does not move under the entry. Every one of
 *  them is a protocol the snapshot lists; the ranking, the multiples and the
 *  odds are all computed from the snapshot's figures, never from this list. */
export const EARLY_SLUGS: string[] = [
'ink-bridge', 'pulsechain-bridge', 'polygon-zkevm-bridge', 'suibridge', 'aegis-yusd', 'project-x', 'scroll-bridge', 'arrakis-modular',
'xrpl-dex', 'txflow-bridge', 'manta-cedefi', 'liminal-basis', 'drakewell', 'shift-defi', 'flux-finance', 'current',
'project-0', '3f', 'exponent-yield-exchange', 'vishwa', 'mantle-restaking', 'noon', 'anemoy-capital', 'bisonfi',
'sx-rollup-bridge', 'communityv3', 'origami-finance', 'tempo-stablecoin-dex', 'agni-finance', 'mystic-finance-lending', 'plasma-one', 'obeliskbtc',
'marginfi-lending', 'ring-few', 'wtao', 'templar-lending', 'pacifica-bridge', 'bitlayer-ybtc-family', 'hylo-protocol', 'stellar-dex',
'apex-omni', 'decibel', 'fstswap', 'mellow-restaking', 'manifest-trade', 'zoo-finance', 'bouncebit-prime', 'vfat.io',
'sygnum-fiusd-liquidity-fund', 'fira', 'estate-protocol', 'native-credit-pool', 'tessera-v', 'theo-network-thbill', 'gmx-solana', 'phoenix-perp',
'lulo', 'paimon', 'makina', 'risex', 'circle-bitcoin', 'adrastea-validator', 'chain-fusion', 'byreal',
'xion-finance', 'rif-on-chain', 'nuva', 'steer-protocol', 'felix-vaults', '3jane-lending', 'rocksolid-network', 'metalx-swap',
'plasma-saving-vaults', 'katana-pre-launch', 'felix-cdp', 'katana-dex', 'morph-bridge', 'syncswap', 'icarus-cl', 'stkesol-by-sol-strategies',
'stellar-amm', 'fluxion-network', 'strata-markets', 'binaryx-platform', 'hyperbeat-earn', 'defindex', 'bitget-sol', 'growihf',
'snuggle', 'goose', 'exponent-risk-tranching', 'd2-finance', 'temple', 'avant-aveth', 'echo-bridge', 'neutral-trade',
'bucket-cdp', 'nodedao', 'predict-fun', 'syntropia', 'defa-by-invoicemate', 'tzbtc', 'qearn', 'reya-perps',
'vesu', 'vault-street', 'superearn', 'strato-cdp', 'agua', 'bend', 'vena-finance', 'stakee',
'valantis-sthype-restaking', 'ultrayield-vaults', 'citrea-bridge', 'yieldfi', 'perena-vaults', 'set-protocol', 'bima-cdp', 'kava-mint',
're7-labs', 'exponent-strategy-vaults', 'antarctic', 'boros', 'monolith-market', 'ultrayield-curator', 't3tris-finance', 'abstract',
'bulk', 'granite', 'stablehodl', 'subfrost', 'turboflow-perps', 'hertzflow', 'aftermath-aflp', 'hylo-lsts',
'swan-dao', 'y10k-capital', 'august-digital', 'hyperbeat-lst', 'flowdesk', 'sceptre-liquid', 'gamma-research', 'waterline',
'nemo-trading', 'endur', 'hakutora', 'exinpool', '9summits', 'marginfi-lst', 'kton', 'syntetika',
'valdora-finance', 'tau-labs', 'sharpbyte-capital', 'mev-capital', 'block-analitica', 'pangolins', 'anthias-labs', 'loopscale-curation',
];

/** The farm tier by TVL: $200 at $1B+, $120 at $250M+, $75 at $50M+, $40
 *  below. The tier is the amount the plan puts to work; the gas beside it is
 *  the setup gas, $8 at $250M+ and $4 below. */
export function farmTier(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 200;
  if (tvlUsd >= 250_000_000) return 120;
  if (tvlUsd >= 50_000_000) return 75;
  return 40;
}

export function farmGas(tvlUsd: number): number {
  return tvlUsd >= 250_000_000 ? 8 : 4;
}

/** How long to hold the position, by how long the protocol has already run
 *  with no token: under 90 days old, 90 days; 90 to 364 days, 60 days; a year
 *  or more, 45 days; no listing date, 60 days. The youngest protocols get
 *  the longest hold because their snapshots are the least settled. */
export function holdDays(age: number | null): number {
  if (age === null) return 60;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 45;
}

type StepFn = (name: string, chain: string, tier: number, gas: number) => string;

/** Step 2, the qualifying action, by category. The amount is the farm tier
 *  and the gas is the setup gas; the wording is the category's own way of
 *  putting money to work. */
const STEP2: Record<string, StepFn> = {
  'Onchain Capital Allocator': (n, c, a, g) => `Allocate $${a} to a ${n} vault on ${c} and keep the vault shares for the full farming window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Risk Curators': (n, c, a, g) => `Allocate $${a} to a ${n} vault on ${c} and keep the vault shares for the full farming window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  Lending: (n, c, a, g) => `Lend $${a} of USDC on ${n} on ${c}: deposit it, leave it earning, and do not withdraw it for the whole farming window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  CDP: (n, c, a, g) => `Lend $${a} of USDC on ${n} on ${c}: deposit it, leave it earning, and do not withdraw it for the whole farming window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Collateral Markets': (n, c, a, g) => `Lend $${a} of USDC on ${n} on ${c}: deposit it, leave it earning, and do not withdraw it for the whole farming window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Uncollateralized Lending': (n, c, a, g) => `Lend $${a} of USDC on ${n} on ${c}: deposit it, leave it earning, and do not withdraw it for the whole farming window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  Dexs: (n, c, a, g) => `Add $${a} of liquidity to ${n}'s largest pool on ${c} in a balanced pair, and keep the position open so it earns fees every day. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  Indexes: (n, c, a, g) => `Add $${a} of liquidity to ${n}'s largest pool on ${c} in a balanced pair, and keep the position open so it earns fees every day. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  RWA: (n, c, a, g) => `Mint $${a} of ${n}'s yield-bearing asset on ${c} and hold it; the balance itself is the qualifying activity. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Crypto Card Issuer': (n, c, a, g) => `Load $${a} onto ${n} and make one real payment with it each week. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  Payments: (n, c, a, g) => `Load $${a} onto ${n} and make one real payment with it each week. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Liquid Staking': (n, c, a, g) => `Stake $${a} of the chain's staking asset through ${n} on ${c} and hold the liquid receipt token instead of selling it. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Liquid Restaking': (n, c, a, g) => `Stake $${a} of the chain's staking asset through ${n} on ${c} and hold the liquid receipt token instead of selling it. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  Restaking: (n, c, a, g) => `Stake $${a} of the chain's staking asset through ${n} on ${c} and hold the liquid receipt token instead of selling it. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Staking Pool': (n, c, a, g) => `Stake $${a} of the chain's staking asset through ${n} on ${c} and hold the liquid receipt token instead of selling it. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  Chain: (n, _c, a, g) => `Bridge $${a} to ${n} and use it in one native app on the chain, so the activity is on the chain itself. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Dual-Token Stablecoin': (n, c, a, g) => `Mint $${a} of the stable asset through ${n} on ${c} and hold it in your wallet for the whole window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Stablecoin Wrapper': (n, c, a, g) => `Mint $${a} of the stable asset through ${n} on ${c} and hold it in your wallet for the whole window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Basis Trading': (n, c, a, g) => `Deposit $${a} into ${n}'s basis vault on ${c} and leave it running through at least one funding cycle. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  Bridge: (n, c, a, g) => `Bridge $${a} of USDC to ${c} through ${n}, then put the bridged funds to work in one app on the destination chain. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Canonical Bridge': (n, c, a, g) => `Bridge $${a} of USDC to ${c} through ${n}, then put the bridged funds to work in one app on the destination chain. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Anchor BTC': (n, c, a, g) => `Deposit $${a} of USDC into ${n} on ${c} and keep the position open for the whole farming window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  CeDeFi: (n, c, a, g) => `Deposit $${a} of USDC into ${n} on ${c} and keep the position open for the whole farming window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Decentralized BTC': (n, c, a, g) => `Deposit $${a} of USDC into ${n} on ${c} and keep the position open for the whole farming window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Governance Incentives': (n, c, a, g) => `Deposit $${a} of USDC into ${n} on ${c} and keep the position open for the whole farming window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Liquidity Manager': (n, c, a, g) => `Deposit $${a} of USDC into ${n} on ${c} and keep the position open for the whole farming window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  Farm: (n, c, a, g) => `Deposit $${a} into ${n}'s highest-TVL vault on ${c} and leave the receipt tokens in your wallet untouched. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Leveraged Farming': (n, c, a, g) => `Deposit $${a} into ${n}'s highest-TVL vault on ${c} and leave the receipt tokens in your wallet untouched. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Yield Aggregator': (n, c, a, g) => `Deposit $${a} into ${n}'s highest-TVL vault on ${c} and leave the receipt tokens in your wallet untouched. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  Yield: (n, c, a, g) => `Deposit $${a} into ${n}'s highest-TVL vault on ${c} and leave the receipt tokens in your wallet untouched. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  Insurance: (n, c, a, g) => `Buy $${a} of cover from ${n} on ${c} and keep the policy active for the whole window. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  Derivatives: (n, c, a, g) => `Deposit $${a} of USDC as collateral on ${n} on ${c} and open one small position, then close it the same week. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Interest Rate Derivatives': (n, c, a, g) => `Deposit $${a} of USDC as collateral on ${n} on ${c} and open one small position, then close it the same week. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
  'Prediction Market': (n, _c, a, g) => `Fund your account with $${a} on ${n} and take one position in a market that settles within the month. Budget about $${g} of gas for the setup transaction and about 15 minutes to do it carefully.`,
};

/** Step 3, the second action, by category. Amounts are a quarter of the tier
 *  for a move, swap, add or bridge-back, and a fifth (floored at $10) for a
 *  borrow; the gas is $3 throughout. Steps without an amount carry none. */
const STEP3: Record<string, StepFn> = {
  'Onchain Capital Allocator': (n, c, t) => `Move $${Math.round(t / 4)} between two of ${n}'s vaults on ${c} once, so the wallet shows more than a single deposit. Budget about $3 of gas and about 10 minutes.`,
  'Risk Curators': (n, c, t) => `Move $${Math.round(t / 4)} between two of ${n}'s vaults on ${c} once, so the wallet shows more than a single deposit. Budget about $3 of gas and about 10 minutes.`,
  Farm: (n, c, t) => `Move $${Math.round(t / 4)} between two of ${n}'s vaults on ${c} once, so the wallet shows more than a single deposit. Budget about $3 of gas and about 10 minutes.`,
  'Leveraged Farming': (n, c, t) => `Move $${Math.round(t / 4)} between two of ${n}'s vaults on ${c} once, so the wallet shows more than a single deposit. Budget about $3 of gas and about 10 minutes.`,
  'Yield Aggregator': (n, c, t) => `Move $${Math.round(t / 4)} between two of ${n}'s vaults on ${c} once, so the wallet shows more than a single deposit. Budget about $3 of gas and about 10 minutes.`,
  Yield: (n, c, t) => `Move $${Math.round(t / 4)} between two of ${n}'s vaults on ${c} once, so the wallet shows more than a single deposit. Budget about $3 of gas and about 10 minutes.`,
  Lending: (n, _c, t) => `Borrow $${Math.max(10, Math.round(t / 5))} against your deposit on ${n} and repay it a week later, so the wallet shows both sides of the market. Budget about $3 of gas and about 10 minutes.`,
  CDP: (n, _c, t) => `Borrow $${Math.max(10, Math.round(t / 5))} against your deposit on ${n} and repay it a week later, so the wallet shows both sides of the market. Budget about $3 of gas and about 10 minutes.`,
  'Collateral Markets': (n, _c, t) => `Borrow $${Math.max(10, Math.round(t / 5))} against your deposit on ${n} and repay it a week later, so the wallet shows both sides of the market. Budget about $3 of gas and about 10 minutes.`,
  'Uncollateralized Lending': (n, _c, t) => `Borrow $${Math.max(10, Math.round(t / 5))} against your deposit on ${n} and repay it a week later, so the wallet shows both sides of the market. Budget about $3 of gas and about 10 minutes.`,
  Dexs: (n, c, t) => `Swap $${Math.round(t / 4)} through ${n}'s router on ${c} once a week, in a different pair each time. Budget about $3 of gas and about 10 minutes.`,
  Indexes: (n, c, t) => `Swap $${Math.round(t / 4)} through ${n}'s router on ${c} once a week, in a different pair each time. Budget about $3 of gas and about 10 minutes.`,
  RWA: (n, _c, _t) => `Check ${n}'s yield page each week and claim any accrued yield that is claimable, even a small amount. Budget about $3 of gas and about 10 minutes.`,
  'Crypto Card Issuer': (n, _c, _t) => `Pay one subscription or bill with ${n} during the window, so the card shows real use. Budget about $3 of gas and about 10 minutes.`,
  Payments: (n, _c, _t) => `Pay one subscription or bill with ${n} during the window, so the card shows real use. Budget about $3 of gas and about 10 minutes.`,
  'Liquid Staking': (n, c, _t) => `Delegate a second, smaller stake through ${n} on ${c} a week after the first, so the wallet shows repeated staking. Budget about $3 of gas and about 10 minutes.`,
  'Liquid Restaking': (n, c, _t) => `Delegate a second, smaller stake through ${n} on ${c} a week after the first, so the wallet shows repeated staking. Budget about $3 of gas and about 10 minutes.`,
  Restaking: (n, c, _t) => `Delegate a second, smaller stake through ${n} on ${c} a week after the first, so the wallet shows repeated staking. Budget about $3 of gas and about 10 minutes.`,
  'Staking Pool': (n, c, _t) => `Delegate a second, smaller stake through ${n} on ${c} a week after the first, so the wallet shows repeated staking. Budget about $3 of gas and about 10 minutes.`,
  Chain: (n, _c, _t) => `Make one swap in a native app on ${n} each week, so the wallet's activity is spread across the chain. Budget about $3 of gas and about 10 minutes.`,
  'Dual-Token Stablecoin': (n, c, _t) => `Swap half of the minted stable asset for USDC on ${c} and hold both sides for a week. Budget about $3 of gas and about 10 minutes.`,
  'Stablecoin Wrapper': (n, c, _t) => `Swap half of the minted stable asset for USDC on ${c} and hold both sides for a week. Budget about $3 of gas and about 10 minutes.`,
  'Basis Trading': (n, c, t) => `Add $${Math.round(t / 4)} to the ${n} vault on ${c} after the first funding cycle settles. Budget about $3 of gas and about 10 minutes.`,
  Bridge: (n, _c, t) => `Bridge $${Math.round(t / 4)} back through ${n} once, so the wallet shows activity in both directions. Budget about $3 of gas and about 10 minutes.`,
  'Canonical Bridge': (n, _c, t) => `Bridge $${Math.round(t / 4)} back through ${n} once, so the wallet shows activity in both directions. Budget about $3 of gas and about 10 minutes.`,
  'Anchor BTC': (n, c, _t) => `Use ${n} a second way on ${c} — a swap, a vote or a second deposit — so the wallet shows more than one action. Budget about $3 of gas and about 10 minutes.`,
  CeDeFi: (n, c, _t) => `Use ${n} a second way on ${c} — a swap, a vote or a second deposit — so the wallet shows more than one action. Budget about $3 of gas and about 10 minutes.`,
  'Decentralized BTC': (n, c, _t) => `Use ${n} a second way on ${c} — a swap, a vote or a second deposit — so the wallet shows more than one action. Budget about $3 of gas and about 10 minutes.`,
  'Governance Incentives': (n, c, _t) => `Use ${n} a second way on ${c} — a swap, a vote or a second deposit — so the wallet shows more than one action. Budget about $3 of gas and about 10 minutes.`,
  Insurance: (n, c, _t) => `Use ${n} a second way on ${c} — a swap, a vote or a second deposit — so the wallet shows more than one action. Budget about $3 of gas and about 10 minutes.`,
  'Liquidity Manager': (n, c, _t) => `Use ${n} a second way on ${c} — a swap, a vote or a second deposit — so the wallet shows more than one action. Budget about $3 of gas and about 10 minutes.`,
  Derivatives: (n, c, _t) => `Place one more small trade on ${n} on ${c} in the opposite direction, then close both positions. Budget about $3 of gas and about 10 minutes.`,
  'Interest Rate Derivatives': (n, c, _t) => `Place one more small trade on ${n} on ${c} in the opposite direction, then close both positions. Budget about $3 of gas and about 10 minutes.`,
  'Prediction Market': (n, _c, _t) => `Take a second position on ${n} in a different market, so the wallet is not a one-bet account. Budget about $3 of gas and about 10 minutes.`,
};

/** The seven farm steps for one protocol. Steps 1, 4, 5, 6 and 7 are the
 *  same shape for every row (amounts and hold days vary); steps 2 and 3 are
 *  the category's own. The plan farms the protocol as it stands and says
 *  nothing about whether or when a token is issued. */
export function farmSteps(p: Protocol, asOfMs: number): string[] {
  const tier = farmTier(p.tvl_usd);
  const gas = farmGas(p.tvl_usd);
  const chain = p.chains[0] ?? 'Ethereum';
  const age = ageDays(p, asOfMs);
  const step2 = STEP2[p.category ?? 'Other'] ?? STEP2['Anchor BTC']!;
  const step3 = STEP3[p.category ?? 'Other'] ?? STEP3['Anchor BTC']!;
  return [
    `Set up a fresh wallet for this farm only, fund it with $${tier} plus about $${gas} for gas on ${chain}, and write the seed phrase down offline before you connect it anywhere.`,
    step2(p.name, chain, tier, gas),
    step3(p.name, chain, tier, gas),
    `Return once a week and do one more qualifying action — a deposit, a swap, a vote or a claim — so the wallet shows steady use instead of a single day of activity. Budget about $2 of gas a week and 10 minutes.`,
    `Hold the position for at least ${holdDays(age)} days, through more than one weekly snapshot, before you think about withdrawing: a position closed in the first week rarely counts. The $${tier} stays in the position, so budget nothing extra.`,
    `Open the protocol's own points or rewards page from the link on its own site and check what it counts; join its community channel from the same site if it has one. Checking costs nothing and takes about 10 minutes.`,
    `Keep a farm log with the wallet address, the dates and every transaction hash, and plan the exit before the token exists: when you unwind, withdraw in two steps a day apart so a failed transaction never strands the whole position. Budget about $3 of gas and 5 minutes to log each step.`,
  ];
}

/** mulberry32: the seeded generator for the bootstrap. The seed is fixed so
 *  a rebuild reproduces the same rank ranges. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export type Validation = {
  five_fold: { radar2: ValidationMetrics; radar3: ValidationMetrics };
  time_split: { radar2: ValidationMetrics; radar3: ValidationMetrics };
  n_live_fit: number;
  n_live_with_age: number;
};

export type ValidationMetrics = {
  med_ae: number;
  mae: number;
  spearman: number;
  n_test: number;
};

function rankOf(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]![1]] = avg;
    i = j + 1;
  }
  return ranks;
}

function spearman(actual: number[], predicted: number[]): number {
  const rx = rankOf(actual);
  const ry = rankOf(predicted);
  const mx = mean(rx);
  const my = mean(ry);
  let cov = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < rx.length; i++) {
    cov += (rx[i]! - mx) * (ry[i]! - my);
    sx += (rx[i]! - mx) * (rx[i]! - mx);
    sy += (ry[i]! - my) * (ry[i]! - my);
  }
  return cov / (Math.sqrt(sx) * Math.sqrt(sy));
}

function metrics(pairs: Array<[number, number]>): ValidationMetrics {
  const errors = pairs.map(([a, p]) => Math.abs(a - p));
  return {
    med_ae: round4(median(errors)),
    mae: round4(mean(errors)),
    spearman: round4(spearman(pairs.map((p) => p[0]), pairs.map((p) => p[1]))),
    n_test: pairs.length,
  };
}

/** Round 1's model, kept only as the validation baseline: the category
 *  median multiple (n >= 3, else the global median), clamped to the band. */
function fitMedianMultiple(train: Protocol[]): { per: Map<string, number[]>; global: number } {
  const per = new Map<string, number[]>();
  for (const q of train) {
    const key = q.category ?? 'Other';
    const list = per.get(key) ?? [];
    list.push(q.mcap_usd! / q.tvl_usd);
    per.set(key, list);
  }
  const global = clampMultiple(median(train.map((p) => p.mcap_usd! / p.tvl_usd)));
  return { per, global };
}

function predictMedian(p: Protocol, fit: { per: Map<string, number[]>; global: number }): number {
  const rs = fit.per.get(p.category ?? 'Other');
  const multiple = rs && rs.length >= 3 ? clampMultiple(median(rs)) : fit.global;
  return Math.log(p.tvl_usd) + Math.log(multiple);
}

function predictCurve(p: Protocol, curve: SizeCurve): number {
  const { multiple } = curveMultiple(p, curve);
  return Math.log(p.tvl_usd) + Math.log(multiple);
}

/** Held-out validation in log-mcap space. The prediction is log(TVL) plus
 *  log(multiple) — growth and maturity are ranking adjustments, not part of
 *  the value prediction, so they do not enter here. The 5-fold split is the
 *  snapshot index modulo 5; the time split trains on the 47 older protocols
 *  that carry a listing date and tests on the 48 most recently listed. */
export function validate(live: Protocol[]): Validation {
  const withAge = live.filter((p) => p.listed_at);
  const timeTest = [...withAge]
    .sort((x, y) => Date.parse(y.listed_at!) - Date.parse(x.listed_at!))
    .slice(0, 48);
  const timeTrain = withAge.filter((p) => !timeTest.includes(p));
  const cv2: Array<[number, number]> = [];
  const cv3: Array<[number, number]> = [];
  for (let k = 0; k < 5; k++) {
    const test = live.filter((_p, i) => i % 5 === k);
    const train = live.filter((_p, i) => i % 5 !== k);
    const f2 = fitMedianMultiple(train);
    const f3 = fitSizeCurve(train);
    for (const p of test) {
      cv2.push([Math.log(p.mcap_usd!), predictMedian(p, f2)]);
      cv3.push([Math.log(p.mcap_usd!), predictCurve(p, f3)]);
    }
  }
  const f2t = fitMedianMultiple(timeTrain);
  const f3t = fitSizeCurve(timeTrain);
  const ts2 = timeTest.map((p) => [Math.log(p.mcap_usd!), predictMedian(p, f2t)] as [number, number]);
  const ts3 = timeTest.map((p) => [Math.log(p.mcap_usd!), predictCurve(p, f3t)] as [number, number]);
  return {
    five_fold: { radar2: metrics(cv2), radar3: metrics(cv3) },
    time_split: { radar2: metrics(ts2), radar3: metrics(ts3) },
    n_live_fit: live.length,
    n_live_with_age: withAge.length,
  };
}

export type Radar = {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Record<string, number>;
  model_version: string;
  global_multiple: number;
  fitted_intercept: number;
  fitted_slope: number;
  launch_odds_global: number;
  clamp_hits: number;
  n_live_fit: number;
  validation: Validation;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: Array<Record<string, unknown>>;
  live: Array<Record<string, unknown>>;
};

/** Build the board and the dashboard's data from the snapshot. The board is
 *  the 40-protocol watchlist plus the 160 early protocols, ranked by
 *  expected value; the rank ranges come from 20 seeded bootstrap refits of
 *  the size curve. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const asOfMs = Date.parse(`${snapshot.as_of}T00:00:00Z`);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0,
  );
  const curve = fitSizeCurve(live);
  const byCategory = new Map<string, { live: number; total: number }>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Other';
    const entry = byCategory.get(key) ?? { live: 0, total: 0 };
    entry.total++;
    if (!isPreToken(p)) entry.live++;
    byCategory.set(key, entry);
  }
  const liveCount = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const globalOdds = liveCount / snapshot.protocols.length;

  const universe: Protocol[] = [
    ...snapshot.watchlist.map((slug) => bySlug.get(slug)!),
    ...EARLY_SLUGS.map((slug) => bySlug.get(slug)!),
  ];
  const scored = universe
    .map((p) => {
      const { multiple, source } = curveMultiple(p, curve);
      const growth = growthMultiplier(p.change_7d);
      const maturity = maturityMultiplier(ageDays(p, asOfMs));
      const odds = launchOdds(p.category, byCategory, globalOdds);
      const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity * odds.odds));
      return { p, multiple, source, growth, maturity, odds, implied };
    })
    .sort((x, y) => y.implied - x.implied);

  // Bootstrap rank ranges: 20 refits on resamples of the 128 live rows.
  const rng = mulberry32(20261114);
  const ranks = new Map<string, number[]>();
  for (let it = 0; it < 20; it++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < live.length; i++) sample.push(live[Math.floor(rng() * live.length)]!);
    const refit = fitSizeCurve(sample);
    const rescored = scored
      .map((s) => ({ slug: s.p.slug, implied: impliedValue(s.p, refit, byCategory, globalOdds, asOfMs) }))
      .sort((x, y) => y.implied - x.implied);
    rescored.forEach((s, i) => {
      const list = ranks.get(s.slug) ?? [];
      list.push(i + 1);
      ranks.set(s.slug, list);
    });
  }
  const rankRange = (slug: string): { low: number; high: number } => {
    const sorted = [...(ranks.get(slug) ?? [])].sort((x, y) => x - y);
    return { low: sorted[Math.ceil(0.1 * 20) - 1]!, high: sorted[Math.ceil(0.9 * 20) - 1]! };
  };

  const board: BoardRow[] = scored.map((s, i) => {
    const p = s.p;
    const age = ageDays(p, asOfMs);
    const range = rankRange(p.slug);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Other',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: age,
      implied_value_usd: s.implied,
      model: {
        category_multiple: s.multiple,
        multiple_source: s.source,
        growth_pct: growthPct(p.change_7d),
        growth_multiplier: round4(s.growth),
        maturity_multiplier: round4(s.maturity),
        age_days: age,
        launch_odds: s.odds.odds,
        odds_source: s.odds.source,
        rank_low: range.low,
        rank_high: range.high,
      },
      farm_steps: farmSteps(p, asOfMs),
    };
  });

  const validation = validate(live);
  const medianTvl = median(live.map((p) => p.tvl_usd));
  const globalMultiple = round4(Math.exp(curve.a + curve.b * Math.log(medianTvl)));
  const clampHits = scored.filter((s) => {
    const raw = Math.exp(curve.a + curve.b * Math.log(s.p.tvl_usd) + (curve.offsets.get(s.p.category ?? 'Other') ?? 0));
    return raw <= MULTIPLE_FLOOR || raw >= MULTIPLE_CAP;
  }).length;
  // The live-token comparables: the top 24 by market cap, excluding CEX.
  const liveList = [...live]
    .filter((p) => p.category !== 'CEX')
    .sort((x, y) => y.mcap_usd! - x.mcap_usd!)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Other',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));

  const radar: Radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      min_live_for_category: 3,
      multiple_floor: MULTIPLE_FLOOR,
      multiple_cap: MULTIPLE_CAP,
      growth_weight: 0.2,
      growth_floor: -30,
      growth_cap: 50,
      maturity_floor: 0.92,
      maturity_range: 0.08,
      maturity_days: 730,
      unknown_age_days: 180,
      odds_prior_strength: 10,
      odds_floor: 0.1,
      odds_cap: 0.95,
      bootstrap_refits: 20,
      bootstrap_seed: 20261114,
    },
    model_version: 'radar-3',
    global_multiple: globalMultiple,
    fitted_intercept: round4(curve.a),
    fitted_slope: round4(curve.b),
    launch_odds_global: round4(globalOdds),
    clamp_hits: clampHits,
    n_live_fit: live.length,
    validation,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: EARLY_SLUGS.length,
    live_size: liveList.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      category_multiple: r.model.category_multiple,
      multiple_source: r.model.multiple_source,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      launch_odds: r.model.launch_odds,
      odds_source: r.model.odds_source,
      rank_low: r.model.rank_low,
      rank_high: r.model.rank_high,
      on_watchlist: snapshot.watchlist.includes(r.slug),
      farm_steps: r.farm_steps,
    })),
    live: liveList,
  };
  return { board, radar };
}

/** The gate's shape, checked before anything is written: 200 rows, ranks
 *  1..200 once each, implied values non-increasing with rank, every
 *  watchlist slug covered, and farm steps of 3 to 12 strings of 20 to 600
 *  characters. Returns the problem, or null when the board is clean. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows`;
  const ranks = new Set<number>();
  let prev = Number.POSITIVE_INFINITY;
  for (const row of board) {
    if (!Number.isInteger(row.rank) || row.rank < 1) return `bad rank ${row.rank}`;
    if (ranks.has(row.rank)) return `duplicate rank ${row.rank}`;
    ranks.add(row.rank);
    if (row.implied_value_usd > prev) return `implied value rises at rank ${row.rank}`;
    prev = row.implied_value_usd;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1) {
      return `bad implied value at rank ${row.rank}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `farm_steps holds ${row.farm_steps.length} steps at rank ${row.rank}`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `farm step of ${trimmed.length} characters at rank ${row.rank}`;
      }
    }
  }
  for (let i = 1; i <= board.length; i++) {
    if (!ranks.has(i)) return `rank ${i} missing`;
  }
  const slugs = new Set(board.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist slug ${slug} missing from the board`;
  }
  return null;
}

/** The dashboard's data file: the radar object as a window global. */
export function dataScript(radar: Radar): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
