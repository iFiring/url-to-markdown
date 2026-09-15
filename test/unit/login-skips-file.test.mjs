// test/unit/login-skips-file.test.mjs
// login_decisions_skips.json（{hostname: [信号名,...]}）的读写助手：
// 形状强转容忍损坏、强信号永不入档、merge 写不清空其他域名。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSkips, recordSkips, RECORDABLE_SIGNALS } from '../../script/lib/snapshot-login.mjs';
import { WEAK_SIGNALS, scoreSignals } from '../../script/lib/detector.mjs';

const mkFile = (content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-skips-'));
  const file = path.join(dir, 'cookies', 'login_decisions_skips.json');
  if (content !== undefined) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return file;
};

test('loadSkips：返回该域名的信号名数组；无文件/无条目 → 空数组', () => {
  assert.deepEqual(loadSkips(mkFile(), 'www.zhihu.com'), []);
  const f = mkFile(JSON.stringify({ 'www.zhihu.com': ['url', 'content'] }));
  assert.deepEqual(loadSkips(f, 'www.zhihu.com'), ['url', 'content']);
  assert.deepEqual(loadSkips(f, 'other.com'), [], '其他域名不受影响');
});

test('loadSkips：损坏内容形状强转容忍，无毒化', () => {
  assert.deepEqual(loadSkips(mkFile('null'), 'a.com'), [], '字面 null');
  assert.deepEqual(loadSkips(mkFile('[]'), 'a.com'), [], '顶层数组');
  assert.deepEqual(loadSkips(mkFile('{oops'), 'a.com'), [], '非法 JSON');
  // 旧版 login_decisions.json 的 {信号: "skip"} 对象条目——按新 schema 不是数组 → 忽略
  assert.deepEqual(loadSkips(mkFile(JSON.stringify({ 'a.com': { loginButton: 'skip' } })), 'a.com'), [],
    '旧格式条目自动失效（知乎误判根因 A 的修复路径）');
  // 数组内混入非字符串 → 过滤
  assert.deepEqual(loadSkips(mkFile(JSON.stringify({ 'a.com': ['url', 42, null] })), 'a.com'), ['url']);
});

test('recordSkips：merge 写入并集，保留其他域名，自动建目录', () => {
  const f = mkFile(JSON.stringify({ 'a.com': ['url'], 'b.com': ['spa'] }));
  recordSkips(f, 'a.com', ['content', 'url']); // 含重复
  const all = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(all['a.com'].sort(), ['content', 'url']);
  assert.deepEqual(all['b.com'], ['spa'], '其他域名原样保留');
  // 目录不存在时自动创建
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-skips-'));
  const nf = path.join(dir, 'cookies', 'login_decisions_skips.json');
  recordSkips(nf, 'c.com', ['url']);
  assert.deepEqual(JSON.parse(fs.readFileSync(nf, 'utf8')), { 'c.com': ['url'] });
});

test('recordSkips：强信号永不入档；过滤后为空则不写文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-skips-'));
  const f = path.join(dir, 'login_decisions_skips.json');
  recordSkips(f, 'a.com', ['loginButton', 'password', 'loginConfirmed']);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { 'a.com': ['loginButton'] },
    'password/loginConfirmed 强信号被过滤，弱信号 loginButton 入档');
  // 只有强信号 → 过滤后为空 → 不落盘（跳过=一次性）
  const f2 = path.join(dir, 'none.json');
  recordSkips(f2, 'a.com', ['password', 'loginConfirmed']);
  assert.equal(fs.existsSync(f2), false, '无弱信号可记时不应创建文件');
});

// —— 人机门禁：content_sparse 入档（RECORDABLE_SIGNALS = 登录弱信号 ∪ content_sparse）——

test('RECORDABLE_SIGNALS：登录弱信号 ∪ content_sparse，不含强信号', () => {
  assert.deepEqual(RECORDABLE_SIGNALS, [...WEAK_SIGNALS, 'content_sparse']);
  assert.ok(!RECORDABLE_SIGNALS.includes('password'));
  assert.ok(!RECORDABLE_SIGNALS.includes('loginConfirmed'));
});

test('recordSkips：content_sparse 可入档，混合去重，强信号仍被过滤', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-skips-'));
  const f = path.join(dir, 'login_decisions_skips.json');
  recordSkips(f, 'a.com', ['content_sparse']);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { 'a.com': ['content_sparse'] });
  // 与登录弱信号共存 + 重复去重 + 强信号过滤
  recordSkips(f, 'a.com', ['content_sparse', 'loginButton', 'password']);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8'))['a.com'].sort(),
    ['content_sparse', 'loginButton']);
});

test('登录计分与 content_sparse 记忆天然隔离（dismissed 判定不受多余条目影响）', () => {
  // 记忆里只有 content_sparse：登录弱信号命中不在记忆内 → 照常计票，不豁免
  const r1 = scoreSignals({ url: true, content: true }, ['content_sparse']);
  assert.equal(r1.dismissed, false);
  assert.equal(r1.needsLogin, true, '记忆外新证据合议成立');
  // 记忆含登录信号 + content_sparse：登录命中全在记忆内 → 照常豁免
  const r2 = scoreSignals({ url: true, content: true }, ['url', 'content', 'content_sparse']);
  assert.equal(r2.dismissed, true);
  assert.equal(r2.needsLogin, false);
  // 无任何登录命中时 content_sparse 不产生票数
  const r3 = scoreSignals({ url: false, content: false }, ['content_sparse']);
  assert.equal(r3.hits, 0);
  assert.equal(r3.dismissed, false);
});
