// Token Radar's value model, radar-3: one sealed snapshot in, one ranked board out.
//
// Round 2 replaces round 1's flat category-median multiple with a fitted size curve, adds
// launch odds, and reports a rank range per row from bootstrap refits. It also validates
// itself at run time — round 1 had no validation at all. Every number below comes from the
// snapshot's own figures; nothing is special-cased by protocol name.
//
//   size curve = OLS on the 128 live-token protocols that report both a market cap and a TVL:
//                log(mcap/TVL) ~ a + b*log(TVL), with a per-category offset = the median
//                residual of the category's live protocols (only when at least 3 report both
//                figures), shrunk toward zero by n/(n+10). Fitted on this snapshot:
//                a = 6.97, b = -0.48 (R2 0.17): bigger protocols price lower per TVL dollar.
//                The old flat median ignored size; the size effect is the single strongest
//                signal in the fitting set (corr -0.41), so the median is retired.
//   multiple   = clamp(exp(a + b*log(TVL) + offset), 0.05, 1.50). The band is a guardrail
//                against absurd extrapolation, the same band round 1 used; the run reports
//                how many board rows it binds on (few — see clamp_hits).
//   growth     = clamp(change_7d, -30, +50) per cent; growthMult = 1 + growth/100 x 0.20.
//                Round 1 used weight 0.60 on [-50, +100]. The snapshot's own live protocols
//                show NO growth premium (corr -0.15 with log ratio; joint slope -0.04 per
//                point, mostly the mechanical denominator effect of a TVL jump), so the
//                weight is cut to a small prior and the clamp narrowed. Disclosed, not hidden.
//   maturity   = 0.92 + 0.08 x min(age_days, 730) / 730; age unknown: 180 days.
//                Round 1 used 0.70 + 0.30 over the same span. Age has NO predictive effect
//                in the fitting set (corr -0.00 with log ratio, n=95), so the factor is
//                narrowed to a weak tenure prior.
//   odds       = the launch odds of the protocol's category: the share of all protocols in
//                the category (live + pre, the whole 758-protocol snapshot) that already
//                have a token, shrunk toward the global rate 416/758 = 0.549 with a prior
//                strength of 10, clamped to [0.10, 0.95]. Categories with fewer than 3
//                protocols use the global rate. This is a population rate, not a model
//                fitted to predict token status for the same rows.
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturityMult x odds)).
//                The board ranks by EXPECTED value: a large implied value in a category
//                that almost never launches a token is worth less than a smaller one in a
//                category that usually does.
//   rank range = p10–p90 of each row's rank across 20 bootstrap refits of the size curve
//                (resampled live protocols, seeded RNG). The odds are population rates and
//                are not refitted.
//
// Validation, computed at run time from the snapshot's own live protocols, isolating the
// launch multiple (growth, maturity and odds apply equally to both models and are excluded):
//   5-fold CV (folds by slug order, fit on train only) and a time split (train on the oldest
//   half by listed_at, test on the newest half), each scored as median absolute error and
//   mean absolute error on log market cap, plus Spearman rank correlation.
//   On this snapshot: 5-fold CV — radar-2 medAE 1.605 / MAE 1.903 / Spearman 0.403;
//   radar-3 medAE 1.241 / MAE 1.618 / Spearman 0.374. Time split — radar-2 medAE 1.656 /
//   MAE 1.981 / Spearman 0.252; radar-3 medAE 1.102 / MAE 1.606 / Spearman 0.321.
//   The size curve wins on absolute error in both checks; Spearman is mixed (worse on CV,
//   better on the time split), which the dashboard says plainly.
//
// Live-token protocols are scored nowhere: their market cap is a fact, not a model, so the
// dashboard shows the top 24 of them in a separate view with their own market caps.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  min_live_for_category: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  odds_prior_strength: number;
  odds_floor: number;
  odds_cap: number;
  bootstrap_refits: number;
  bootstrap_seed: number;
}

export const MODEL: ModelConstants = {
  min_live_for_category: 3,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
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
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many early rows the board carries beyond the watchlist. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    multiple_source: 'curve' | 'curve+category';
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    launch_odds: number;
    odds_source: 'category' | 'global';
    rank_low: number;
    rank_high: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included so the page shows the board's own steps. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  multiple_source: 'curve' | 'curve+category';
  growth_multiplier: number;
  maturity_multiplier: number;
  launch_odds: number;
  odds_source: 'category' | 'global';
  rank_low: number;
  rank_high: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One validation check's metrics, on log market cap. */
export interface ValidationMetric {
  med_ae: number;
  mae: number;
  spearman: number;
  n_test: number;
}

/** The run-time validation: both models, two checks. */
export interface Validation {
  five_fold: { radar2: ValidationMetric; radar3: ValidationMetric };
  time_split: { radar2: ValidationMetric; radar3: ValidationMetric };
  n_live_fit: number;
  n_live_with_age: number;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
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
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a version marker is a pool of another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A name carrying a whole word wrapped, staked or staking is a product of a token that trades. */
const WRAPPED_PRODUCT = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool, not a wrapped or staked product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !WRAPPED_PRODUCT.test(p.name);
}

/** The median of a non-empty list, or null. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The mean of a non-empty list. */
function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Spearman rank correlation of two equal-length series, with average ranks for ties. */
function spearman(a: number[], b: number[]): number {
  const ranks = (xs: number[]): number[] => {
    const order = xs.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
    const out = new Array<number>(xs.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[order[k]!.i] = avg;
      i = j + 1;
    }
    return out;
  };
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    const x = ra[i]! - ma;
    const y = rb[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

/** A small seeded RNG (mulberry32) so bootstrap refits are deterministic. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The live-token protocols the size curve is fitted on: both a market cap and a TVL. */
export function fittingSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => !isPreToken(p) && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0);
}

/** The fitted size curve: OLS log(mcap/TVL) ~ intercept + slope*log(TVL), plus shrunk category offsets. */
export interface SizeCurveFit {
  intercept: number;
  slope: number;
  offsets: Map<string, number>;
  n_live: number;
}

export function fitSizeCurve(live: SnapshotProtocol[], model: ModelConstants = MODEL): SizeCurveFit {
  const xs = live.map((p) => Math.log(p.tvl_usd));
  const ys = live.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  // Per-category offset: the median residual of the category's live protocols, shrunk toward
  // zero by n/(n+10) so a category with 3 live protocols does not steer the board on its own.
  const residuals = new Map<string, number[]>();
  for (let i = 0; i < live.length; i++) {
    const pred = intercept + slope * xs[i]!;
    const key = live[i]!.category ?? 'Other';
    const list = residuals.get(key) ?? [];
    list.push(ys[i]! - pred);
    residuals.set(key, list);
  }
  const offsets = new Map<string, number>();
  for (const [key, rs] of residuals) {
    if (rs.length >= model.min_live_for_category) {
      const m = median(rs);
      if (m !== null) offsets.set(key, (m * rs.length) / (rs.length + 10));
    }
  }
  return { intercept, slope, offsets, n_live: live.length };
}

/** The launch multiple one protocol gets from the fitted curve, and whether a category offset applied. */
export function ratioFor(
  p: SnapshotProtocol,
  fit: SizeCurveFit,
  model: ModelConstants = MODEL,
): { ratio: number; raw: number; source: 'curve' | 'curve+category'; clamped: boolean } {
  const offset = p.category === null ? undefined : fit.offsets.get(p.category);
  const raw = Math.exp(fit.intercept + fit.slope * Math.log(Math.max(1, p.tvl_usd)) + (offset ?? 0));
  const clamped = raw < model.multiple_floor || raw > model.multiple_cap;
  const ratio = Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
  return { ratio, raw, source: offset !== undefined ? 'curve+category' : 'curve', clamped };
}

/** The launch odds: per-category token rates over the whole snapshot, shrunk toward the global rate. */
export interface LaunchOdds {
  byCategory: Map<string, number>;
  global: number;
  globalLive: number;
  globalTotal: number;
}

export function launchOdds(snapshot: Snapshot, model: ModelConstants = MODEL): LaunchOdds {
  const counts = new Map<string, { live: number; total: number }>();
  let globalLive = 0;
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Other';
    const c = counts.get(key) ?? { live: 0, total: 0 };
    c.total++;
    if (!isPreToken(p)) {
      c.live++;
      globalLive++;
    }
    counts.set(key, c);
  }
  const globalTotal = snapshot.protocols.length;
  const global = globalTotal === 0 ? 0.5 : globalLive / globalTotal;
  const k = model.odds_prior_strength;
  const shrink = (live: number, total: number): number =>
    Math.min(model.odds_cap, Math.max(model.odds_floor, (live + k * global) / (total + k)));
  const byCategory = new Map<string, number>();
  for (const [key, c] of counts) {
    if (c.total >= model.min_live_for_category) byCategory.set(key, shrink(c.live, c.total));
  }
  return { byCategory, global: shrink(globalLive, globalTotal), globalLive, globalTotal };
}

/** The launch odds one protocol gets, and whether they came from its category or the global rate. */
export function oddsFor(p: SnapshotProtocol, odds: LaunchOdds): { odds: number; source: 'category' | 'global' } {
  const fromCategory = p.category === null ? undefined : odds.byCategory.get(p.category);
  if (fromCategory !== undefined) return { odds: fromCategory, source: 'category' };
  return { odds: odds.global, source: 'global' };
}

/** The multipliers and the expected implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: SizeCurveFit,
  odds: LaunchOdds,
  model: ModelConstants,
): { implied: number; multiple: number; source: 'curve' | 'curve+category'; clamped: boolean; growthPct: number; growthMult: number; maturityMult: number; age: number | null; launchOdds: number; oddsSource: 'category' | 'global' } {
  const age = ageDays(asOf, protocol.listed_at);
  const { ratio, source, clamped } = ratioFor(protocol, fit, model);
  const { odds: launchOdds, source: oddsSource } = oddsFor(protocol, odds);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * ratio * growthMult * maturityMult * launchOdds));
  return { implied, multiple: ratio, source, clamped, growthPct, growthMult, maturityMult, age, launchOdds, oddsSource };
}

/** Round 1's median multiples, fitted on a given live subset — used only to validate against. */
function medianMultiples(live: SnapshotProtocol[], model: ModelConstants): { byCategory: Map<string, number>; global: number } {
  const clamp = (v: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, v));
  const globalMed = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const global = clamp(globalMed ?? 0.25);
  const byCategory = new Map<string, number>();
  const perCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = perCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    perCategory.set(key, list);
  }
  for (const [key, ratios] of perCategory) {
    if (ratios.length >= model.min_live_for_category) {
      const m = median(ratios);
      if (m !== null) byCategory.set(key, clamp(m));
    }
  }
  return { byCategory, global };
}

/** Score one check: both models predict log market cap for the test set, from a train fit. */
function scoreCheck(
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
  model: ModelConstants,
): { radar2: ValidationMetric; radar3: ValidationMetric } {
  const med = medianMultiples(train, model);
  const fit = fitSizeCurve(train, model);
  const pred2: number[] = [];
  const pred3: number[] = [];
  const actual: number[] = [];
  for (const p of test) {
    const fromCategory = p.category === null ? undefined : med.byCategory.get(p.category);
    const ratio2 = fromCategory !== undefined ? fromCategory : med.global;
    const ratio3 = ratioFor(p, fit, model).ratio;
    pred2.push(Math.log(p.tvl_usd) + Math.log(ratio2));
    pred3.push(Math.log(p.tvl_usd) + Math.log(ratio3));
    actual.push(Math.log(p.mcap_usd!));
  }
  const metric = (pred: number[]): ValidationMetric => {
    const errs = pred.map((v, i) => Math.abs(v - actual[i]!)).sort((a, b) => a - b);
    const mid = Math.floor(errs.length / 2);
    const medAe = errs.length % 2 === 1 ? errs[mid]! : (errs[mid - 1]! + errs[mid]!) / 2;
    return {
      med_ae: round4(medAe),
      mae: round4(mean(errs)),
      spearman: round4(spearman(pred, actual)),
      n_test: actual.length,
    };
  };
  return { radar2: metric(pred2), radar3: metric(pred3) };
}

/**
 * The run-time validation: 5-fold cross-validation (folds by slug order, fit on train only)
 * and a time split (train on the oldest half by listed_at, test on the newest half).
 * Both models are fitted on train only, so nothing is scored on the protocols that fitted it.
 */
export function validateModels(snapshot: Snapshot, model: ModelConstants = MODEL): Validation {
  const live = fittingSet(snapshot);
  const bySlug = [...live].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  // 5-fold: pool the out-of-fold predictions, then score once.
  const all2: number[] = [];
  const all3: number[] = [];
  const allActual: number[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const test = bySlug.filter((_, i) => i % 5 === fold);
    const train = bySlug.filter((_, i) => i % 5 !== fold);
    const med = medianMultiples(train, model);
    const fit = fitSizeCurve(train, model);
    for (const p of test) {
      const fromCategory = p.category === null ? undefined : med.byCategory.get(p.category);
      const ratio2 = fromCategory !== undefined ? fromCategory : med.global;
      all2.push(Math.log(p.tvl_usd) + Math.log(ratio2));
      all3.push(Math.log(p.tvl_usd) + Math.log(ratioFor(p, fit, model).ratio));
      allActual.push(Math.log(p.mcap_usd!));
    }
  }
  const pooledMetric = (pred: number[]): ValidationMetric => {
    const errs = pred.map((v, i) => Math.abs(v - allActual[i]!)).sort((a, b) => a - b);
    const mid = Math.floor(errs.length / 2);
    const medAe = errs.length % 2 === 1 ? errs[mid]! : (errs[mid - 1]! + errs[mid]!) / 2;
    return { med_ae: round4(medAe), mae: round4(mean(errs)), spearman: round4(spearman(pred, allActual)), n_test: allActual.length };
  };
  const fiveFold = { radar2: pooledMetric(all2), radar3: pooledMetric(all3) };
  // Time split: oldest half trains, newest half is tested.
  const withAge = [...live]
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const cut = Math.floor(withAge.length / 2);
  const timeSplit = scoreCheck(withAge.slice(0, cut), withAge.slice(cut), model);
  return { five_fold: fiveFold, time_split: timeSplit, n_live_fit: live.length, n_live_with_age: withAge.length };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 75;
  return 40;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's main farming action, in words a farmer can follow. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} on ${chain}: deposit it, leave it earning, and do not withdraw it for the whole farming window.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${name}'s largest pool on ${chain} in a balanced pair, and keep the position open so it earns fees every day.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and leave the receipt tokens in your wallet untouched.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then put the bridged funds to work in one app on the destination chain.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the liquid receipt token instead of selling it.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as collateral on ${name} on ${chain} and open one small position, then close it the same week.`;
  if (c.includes('prediction')) return `Fund your account with $${capital} on ${name} and take one position in a market that settles within the month.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Allocate $${capital} to a ${name} vault on ${chain} and keep the vault shares for the full farming window.`;
  if (c.includes('stable') || c.includes('dual-token')) return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it in your wallet for the whole window.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it; the balance itself is the qualifying activity.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the whole window.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and leave it running through at least one funding cycle.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name} and use it in one native app on the chain, so the activity is on the chain itself.`;
  if (c.includes('payment') || c.includes('card')) return `Load $${capital} onto ${name} and make one real payment with it each week.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it for the whole window.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the whole farming window.`;
}

/** A second, different qualifying action for the same protocol, so the plan is not one deposit repeated. */
function secondAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${Math.max(10, Math.round(capital / 5))} against your deposit on ${name} and repay it a week later, so the wallet shows both sides of the market.`;
  if (c.includes('dex')) return `Swap $${Math.max(10, Math.round(capital / 4))} through ${name}'s router on ${chain} once a week, in a different pair each time.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Move $${Math.max(10, Math.round(capital / 4))} between two of ${name}'s vaults on ${chain} once, so the wallet shows more than a single deposit.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${Math.max(10, Math.round(capital / 4))} back through ${name} once, so the wallet shows activity in both directions.`;
  if (c.includes('stak') || c.includes('restak')) return `Delegate a second, smaller stake through ${name} on ${chain} a week after the first, so the wallet shows repeated staking.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Place one more small trade on ${name} on ${chain} in the opposite direction, then close both positions.`;
  if (c.includes('prediction')) return `Take a second position on ${name} in a different market, so the wallet is not a one-bet account.`;
  if (c.includes('stable') || c.includes('dual-token')) return `Swap half of the minted stable asset for USDC on ${chain} and hold both sides for a week.`;
  if (c.includes('rwa')) return `Check ${name}'s yield page each week and claim any accrued yield that is claimable, even a small amount.`;
  if (c.includes('basis')) return `Add $${Math.max(10, Math.round(capital / 4))} to the ${name} vault on ${chain} after the first funding cycle settles.`;
  if (c.includes('chain')) return `Make one swap in a native app on ${name} each week, so the wallet's activity is spread across the chain.`;
  if (c.includes('payment') || c.includes('card')) return `Pay one subscription or bill with ${name} during the window, so the card shows real use.`;
  if (c.includes('index')) return `Rebalance once: sell a tenth of the index token and buy it back a week later.`;
  return `Use ${name} a second way on ${chain} — a swap, a vote or a second deposit — so the wallet shows more than one action.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 120 ? 8 : 4;
  const steps = [
    `Set up a fresh wallet for this farm only, fund it with $${capital} plus about $${gas} for gas on ${chain}, and write the seed phrase down offline before you connect it anywhere.`,
    `${mainAction(p, capital, chain)} Budget about $${gas} of gas for the setup transaction and about 15 minutes to do it carefully.`,
    `${secondAction(p, capital, chain)} Budget about $3 of gas and about 10 minutes.`,
    `Return once a week and do one more qualifying action — a deposit, a swap, a vote or a claim — so the wallet shows steady use instead of a single day of activity. Budget about $2 of gas a week and 10 minutes.`,
    `Hold the position for at least ${hold} days, through more than one weekly snapshot, before you think about withdrawing: a position closed in the first week rarely counts. The $${capital} stays in the position, so budget nothing extra.`,
    `Open the protocol's own points or rewards page from the link on its own site and check what it counts; join its community channel from the same site if it has one. Checking costs nothing and takes about 10 minutes.`,
    `Keep a farm log with the wallet address, the dates and every transaction hash, and plan the exit before the token exists: when you unwind, withdraw in two steps a day apart so a failed transaction never strands the whole position. Budget about $3 of gas and 5 minutes to log each step.`,
  ];
  return steps.map((s) => {
    let out = s.trim();
    if (out.length > 600) out = `${out.slice(0, 596)}...`;
    if (out.length < 20) out = `${out} Hold the position and check the protocol's own page.`;
    return out;
  });
}

/** The protocols the board ranks, strongest first, with ranks 1..n and a bootstrap rank range per row. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitSizeCurve(fittingSet(snapshot), model);
  const odds = launchOdds(snapshot, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by TVL, capped.
  // A chosen protocol stays chosen; the early rows are the radar's discovery, not its replacement.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const chosenList = [...chosen.values()];
  const live = fittingSet(snapshot);
  // Bootstrap rank ranges: refit the size curve on resampled live protocols and re-rank.
  // The odds are population rates and are not refitted; growth and maturity are fixed priors.
  const rng = mulberry32(model.bootstrap_seed);
  const ranksBySlug = new Map<string, number[]>();
  for (let b = 0; b < model.bootstrap_refits; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < live.length; i++) sample.push(live[Math.floor(rng() * live.length)]!);
    const refit = fitSizeCurve(sample, model);
    const rescored = chosenList
      .map((p) => ({ slug: p.slug, implied: impliedValue(p, snapshot.as_of, refit, odds, model).implied }))
      .sort((a, c) => c.implied - a.implied || (a.slug < c.slug ? -1 : a.slug > c.slug ? 1 : 0));
    rescored.forEach((s, i) => {
      const list = ranksBySlug.get(s.slug) ?? [];
      list.push(i + 1);
      ranksBySlug.set(s.slug, list);
    });
  }
  const rangeFor = (slug: string): { low: number; high: number } => {
    const rs = [...(ranksBySlug.get(slug) ?? [1])].sort((a, b) => a - b);
    const q = (p: number): number => rs[Math.floor(p * (rs.length - 1))]!;
    return { low: q(0.1), high: q(0.9) };
  };

  const scored = chosenList.map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, odds, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const range = rangeFor(s.p.slug);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        category_multiple: s.multiple,
        multiple_source: s.source,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
        launch_odds: s.launchOdds,
        odds_source: s.oddsSource,
        rank_low: range.low,
        rank_high: range.high,
      },
      farm_steps: farmSteps(s.p, s.age),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, farm plan included. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    multiple_source: row.model.multiple_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    launch_odds: row.model.launch_odds,
    odds_source: row.model.odds_source,
    rank_low: row.model.rank_low,
    rank_high: row.model.rank_high,
    on_watchlist: onWatchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const fit = fitSizeCurve(fittingSet(snapshot), model);
  const odds = launchOdds(snapshot, model);
  const validation = validateModels(snapshot, model);
  const watchSet = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchSet.has(r.slug)).length;
  // The curve's ratio at the median live TVL, as the dashboard's single reference multiple.
  const medianLiveTvl = median(fittingSet(snapshot).map((p) => p.tvl_usd)) ?? 0;
  const globalMultiple = round4(Math.exp(fit.intercept + fit.slope * Math.log(Math.max(1, medianLiveTvl))));
  const clampHits = board.reduce((n, r) => n + (ratioFor(r, fit, model).clamped ? 1 : 0), 0);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: globalMultiple,
    fitted_intercept: round4(fit.intercept),
    fitted_slope: round4(fit.slope),
    launch_odds_global: round4(odds.global),
    clamp_hits: clampHits,
    n_live_fit: fit.n_live,
    validation,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchSet.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
