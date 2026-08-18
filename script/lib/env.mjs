// script/lib/env.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

export function projectRoot() { return path.resolve(thisDir, '..', '..'); }

export function workingRoot() {
  return process.env.U2M_WORKING_ROOT
    ? path.resolve(process.env.U2M_WORKING_ROOT)
    : path.join(projectRoot(), 'working');
}

/** URL→目录名：非 [A-Za-z0-9-] → _；>120 截断 + sha256(URL) 前 8 hex。Node/Python 必须一致。 */
export function urlToDirName(url) {
  const sanitized = url.replace(/[^A-Za-z0-9-]/g, '_');
  if (sanitized.length <= 120) return sanitized;
  const hash = crypto.createHash('sha256').update(url, 'utf8').digest('hex').slice(0, 8);
  return sanitized.slice(0, 120) + hash;
}

export function storageStatePath() { return path.join(workingRoot(), 'cookies', 'storage_state.json'); }

export function workflowDir(url, name) { return path.join(workingRoot(), urlToDirName(url), name); }

export function ensureWorkflowDirs(url, name) {
  const wf = workflowDir(url, name);
  const assets = path.join(wf, 'assets');
  const draft = path.join(assets, 'draft');
  const complex = path.join(assets, 'complex');
  const images = path.join(assets, 'images');
  for (const d of [wf, assets, draft, complex, images]) fs.mkdirSync(d, { recursive: true });
  return { wf, assets, draft, complex, images, manifest: path.join(assets, 'manifest.json') };
}
