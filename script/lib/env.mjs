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

/** 重定向特殊目录名：redirected_ + 与 urlToDirName 同款净化；>120 截断 + sha256('redirected_'+url) 前 8 位。 */
export function redirectedDirName(url) {
  const prefixed = 'redirected_' + url.replace(/^https?:\/\//i, '').replace(/[^A-Za-z0-9.-]/g, '_');
  if (prefixed.length <= 120) return prefixed;
  const hash = crypto.createHash('sha256').update('redirected_' + url, 'utf8').digest('hex').slice(0, 8);
  return prefixed.slice(0, 120) + hash;
}

/** marker 文件：working/redirected_<名>/redirect_to.yaml。定位只依赖存在性，内容纯诊断。 */
export function redirectMarkerPath(url) {
  return path.join(workingRoot(), redirectedDirName(url), 'redirect_to.yaml');
}

export function hasRedirectMarker(url) {
  return fs.existsSync(redirectMarkerPath(url));
}

/** 快照成功后写入（唯一写者 snapshot.mjs）。 */
export function writeRedirectMarker(url, to) {
  const file = redirectMarkerPath(url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `to: ${to}\n`, 'utf8');
}

/** 步骤 1 检测未命中时清理 stale marker；不存在则静默。 */
export function clearRedirectMarker(url) {
  try { fs.unlinkSync(redirectMarkerPath(url)); } catch { /* 不存在即无操作 */ }
}

export function urlDir(url) {
  const name = hasRedirectMarker(url) ? redirectedDirName(url) : urlToDirName(url);
  return path.join(workingRoot(), name);
}

/** 产物目录：working/<url-dir>/ 直接放步骤文件 + assets/。dirName 覆写目录名
 * （步骤 1 在 marker 写入前显式指定 redirected_ 名用）；缺省按 urlToDirName(url)。 */
export function ensureUrlDirs(url, dirName) {
  const dir = path.join(workingRoot(), dirName || urlToDirName(url));
  const assets = path.join(dir, 'assets');
  const images = path.join(assets, 'images');
  const trans = path.join(assets, 'trans');
  for (const d of [dir, assets, images, trans]) fs.mkdirSync(d, { recursive: true });
  return { urlDir: dir, wf: dir, assets, images, trans };
}
