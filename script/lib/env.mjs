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

/**
 * URL→目录名：先剥 http(s):// 前缀（目录名从域名开始），
 * 其余非 [A-Za-z0-9.-] → _；>120 截断 + sha256(原URL) 前 8 hex。
 * 注意：同域名的 http/https 两版会派生同一目录（视为同一站点）。
 */
export function urlToDirName(url) {
  const sanitized = url.replace(/^https?:\/\//i, '').replace(/[^A-Za-z0-9.-]/g, '_');
  if (sanitized.length <= 120) return sanitized;
  const hash = crypto.createHash('sha256').update(url, 'utf8').digest('hex').slice(0, 8);
  return sanitized.slice(0, 120) + hash;
}

export function storageStatePath() { return path.join(workingRoot(), 'cookies', 'storage_state.json'); }

export function urlDir(url) { return path.join(workingRoot(), urlToDirName(url)); }

/** 产物目录：working/<url-dir>/ 直接放步骤文件 + assets/。 */
export function ensureUrlDirs(url) {
  const dir = urlDir(url);
  const assets = path.join(dir, 'assets');
  const images = path.join(assets, 'images');
  const trans = path.join(assets, 'trans');
  for (const d of [dir, assets, images, trans]) fs.mkdirSync(d, { recursive: true });
  return { urlDir: dir, wf: dir, assets, images, trans };
}
