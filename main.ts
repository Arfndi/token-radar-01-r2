// main.ts — the entrypoint for token-radar-01, round 3.
//
// Reads the sealed DefiLlama snapshot, builds the radar-3 board (the
// 40-protocol watchlist plus the 160 early protocols, ranked by expected
// value), writes board.json, data.js and dossier.json, and copies the
// dashboard and the three screenshots into the output directory.
//
// Run it with Node, not Bun: the two engines differ in the last ulp of
// Math.exp and Math.log, and the byte-identical outputs this entry promises
// are the ones Node's V8 produces.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The input may be the snapshot file itself or a directory holding it. The
// output directory defaults to /output when MAKEFUN_OUTPUT_DIR is not set.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boardIssue,
  buildRadar,
  curveMultiple,
  fitSizeCurve,
  growthMultiplier,
  growthPct,
  isPreToken,
  launchOdds,
  maturityMultiplier,
  parseSnapshot,
  round4,
  dataScript,
  type BoardRow,
  type Snapshot,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** The dossier's text — the dashboard source embedded in it — is capped at
 *  65,536 bytes. The dashboard itself is far under that, so the cap never
 *  binds; it is there because the gate requires it. */
const TEXT_MAX_BYTES = 65_536;
/** At most four screenshots, each at most 512 KiB. */
const SCREENSHOT_CAPS = { max_files: 4, max_bytes: 524_288 };
/** The dashboard is at most 400 files and 4 MiB in total. */
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };

type Args = { input: string | null; output: string | null };

function parseArgs(argv: string[]): Args {
  const args: Args = { input: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) args.input = argv[++i]!;
    else if (argv[i] === '--output' && i + 1 < argv.length) args.output = argv[++i]!;
  }
  return args;
}

/** Resolve the snapshot path: a file is used as it is; a directory is
 *  expected to hold snapshot.json. */
function resolveSnapshotPath(input: string): string {
  const resolved = resolve(input);
  if (!existsSync(resolved)) throw new Error(`input not found: ${resolved}`);
  if (statSync(resolved).isFile()) return resolved;
  const direct = join(resolved, 'snapshot.json');
  if (existsSync(direct)) return direct;
  throw new Error(`no snapshot.json in ${resolved}`);
}

function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

/** The build-time self-check: re-derive every board row from the snapshot
 *  and the model, and refuse to write anything if a row does not match.
 *  The launch odds and the category multiple are stored at full precision —
 *  round 2 fixed a bug where the odds were rounded to four decimals — so
 *  the check is exact: the stored odds and multiple must equal the model's
 *  own values, and the stored implied value must equal the value the model
 *  computes from them. The growth and maturity multipliers are stored
 *  rounded to four decimals, so they are compared after the same rounding. */
function selfCheck(board: BoardRow[], snapshot: Snapshot): void {
  const asOfMs = Date.parse(`${snapshot.as_of}T00:00:00Z`);
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
  for (const row of board) {
    const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
    const p = bySlug.get(row.slug);
    if (!p) throw new Error(`self-check: board row ${row.slug} is not in the snapshot`);
    const { multiple } = curveMultiple(p, curve);
    const growth = growthMultiplier(p.change_7d);
    const maturity = maturityMultiplier(row.model.age_days);
    const { odds } = launchOdds(p.category, byCategory, globalOdds);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity * odds));
    if (row.model.category_multiple !== multiple) {
      throw new Error(`self-check: ${row.slug} category_multiple ${row.model.category_multiple} != ${multiple}`);
    }
    if (row.model.launch_odds !== odds) {
      throw new Error(`self-check: ${row.slug} launch_odds ${row.model.launch_odds} != ${odds}`);
    }
    if (row.model.growth_multiplier !== round4(growth)) {
      throw new Error(`self-check: ${row.slug} growth_multiplier ${row.model.growth_multiplier} != ${round4(growth)}`);
    }
    if (row.model.maturity_multiplier !== round4(maturity)) {
      throw new Error(`self-check: ${row.slug} maturity_multiplier ${row.model.maturity_multiplier} != ${round4(maturity)}`);
    }
    if (row.model.growth_pct !== growthPct(p.change_7d)) {
      throw new Error(`self-check: ${row.slug} growth_pct ${row.model.growth_pct} != ${growthPct(p.change_7d)}`);
    }
    if (row.implied_value_usd !== implied) {
      throw new Error(`self-check: ${row.slug} implied ${row.implied_value_usd} != ${implied}`);
    }
  }
}

function main(): void {
  const argv = parseArgs(process.argv.slice(2));
  const inputArg = argv.input ?? process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const out = resolve(argv.output ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const snapshotPath = resolveSnapshotPath(inputArg);
  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));

  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue) throw new Error(`board issue: ${issue}`);
  selfCheck(board, snapshot);

  const preToken = snapshot.protocols.filter(isPreToken).length;
  const liveFit = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0,
  );
  const curve = fitSizeCurve(liveFit);
  const top = board[0]!;
  console.log(
    `token radar: ${snapshot.protocols.length} protocols, ${preToken} pre-token, ${liveFit.length} live for the fit`,
  );
  console.log(
    `token radar: curve log(mcap/TVL) = ${radar.fitted_intercept} ${radar.fitted_slope}·log(TVL), ${curve.offsets.size} category offsets`,
  );
  console.log(
    `token radar: board ${board.length} rows (${radar.watchlist_size} watchlist, ${radar.early_size} early), top ${top.name} $${top.implied_value_usd.toLocaleString('en-US')}`,
  );
  console.log(`token radar: multiple band binds on ${radar.clamp_hits} board rows`);
  console.log(
    `token radar: 5-fold CV medAE ${radar.validation.five_fold.radar3.med_ae}, time split medAE ${radar.validation.time_split.radar3.med_ae}`,
  );

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));
  copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
  copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
  const dossier = buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  });
  writeFileSync(join(out, 'dossier.json'), dossier);
  console.log(`token radar: wrote ${out}`);
}

main();
