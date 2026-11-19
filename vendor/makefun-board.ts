// vendor/makefun-board.ts — the dossier builder for token-radar-01.
//
// buildDossier reads the dashboard and the screenshots out of an output
// directory and assembles the dossier: the dashboard source embedded as
// fenced code blocks, and the screenshots as base64 images with sha256
// digests. The dossier is the deliverable the gate reads, so the format is
// fixed: a compact JSON object with the keys cover, images, schema, text,
// and no trailing newline.
//
// The text is the dashboard, file by file:
//   ## Dashboard
//   Files: N (total bytes)
//   - name (bytes)
//   ...
//   ## Source
//   ### name
//   bytes, lines
//   ```lang
//   <the file, trailing newline stripped>
//   ```
//   ...
// The byte and line counts describe the file as it sits on disk; the
// embedded copy has its single trailing newline stripped.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type DossierOptions = {
  text_max_bytes: number;
  screenshots: { max_files: number; max_bytes: number };
  dashboard: { max_files: number; max_bytes: number };
};

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const LANGUAGES: Record<string, string> = {
  '.html': 'html',
  '.css': 'css',
  '.js': 'js',
  '.ts': 'ts',
  '.json': 'json',
  '.md': 'md',
};

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot) : '';
}

function lineCount(text: string): number {
  const parts = text.split('\n');
  return parts.length - (text.endsWith('\n') ? 1 : 0);
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function buildDossier(out: string, options: DossierOptions): string {
  const dashboardDir = join(out, 'dashboard');
  const screenshotDir = join(out, 'screenshots');

  const dashboardNames = readdirSync(dashboardDir)
    .filter((name) => statSync(join(dashboardDir, name)).isFile())
    .sort();
  if (dashboardNames.length > options.dashboard.max_files) {
    throw new Error(`dashboard holds ${dashboardNames.length} files, over the cap of ${options.dashboard.max_files}`);
  }
  const dashboardFiles = dashboardNames.map((name) => {
    const bytes = readFileSync(join(dashboardDir, name));
    const text = bytes.toString('utf8');
    return { name, bytes, text, byteLength: bytes.length, lines: lineCount(text) };
  });
  const dashboardTotal = dashboardFiles.reduce((sum, f) => sum + f.byteLength, 0);
  if (dashboardTotal > options.dashboard.max_bytes) {
    throw new Error(`dashboard totals ${dashboardTotal} bytes, over the cap of ${options.dashboard.max_bytes}`);
  }

  const screenshotNames = readdirSync(screenshotDir)
    .filter((name) => statSync(join(screenshotDir, name)).isFile())
    .sort();
  if (screenshotNames.length > options.screenshots.max_files) {
    throw new Error(`screenshots hold ${screenshotNames.length} files, over the cap of ${options.screenshots.max_files}`);
  }
  const images = screenshotNames.map((name) => {
    const bytes = readFileSync(join(screenshotDir, name));
    if (bytes.length > options.screenshots.max_bytes) {
      throw new Error(`screenshot ${name} is ${bytes.length} bytes, over the cap of ${options.screenshots.max_bytes}`);
    }
    return {
      base64: bytes.toString('base64'),
      media_type: MEDIA_TYPES[extension(name)] ?? 'image/png',
      name,
      sha256: sha256Hex(bytes),
    };
  });

  let text = `## Dashboard\n\nFiles: ${dashboardFiles.length} (${dashboardTotal} bytes)\n`;
  for (const f of dashboardFiles) text += `- ${f.name} (${f.byteLength} bytes)\n`;
  text += `\n## Source\n\n`;
  const sections = dashboardFiles.map((f) => {
    const lang = LANGUAGES[extension(f.name)] ?? extension(f.name).replace(/^\./, '');
    const embedded = f.text.endsWith('\n') ? f.text.slice(0, -1) : f.text;
    return `### ${f.name}\n\n${f.byteLength} bytes, ${f.lines} lines\n\n\`\`\`${lang}\n${embedded}\n\`\`\`\n`;
  });
  // The sections are separated by one blank line; the last ends the text.
  text += sections.join('\n');
  if (Buffer.byteLength(text, 'utf8') > options.text_max_bytes) {
    throw new Error(`dossier text is ${Buffer.byteLength(text, 'utf8')} bytes, over the cap of ${options.text_max_bytes}`);
  }

  const dossier = { cover: 0, images, schema: 'makefun/dossier/v1', text };
  return JSON.stringify(dossier);
}
