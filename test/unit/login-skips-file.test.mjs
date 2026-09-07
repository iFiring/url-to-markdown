// test/unit/login-skips-file.test.mjs
// login_decisions_skips.json（{hostname: [信号名,...]}）的读写助手：
// 形状强转容忍损坏、强信号永不入档、merge 写不清空其他域名。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSkips, recordSkips } from '../../script/lib/snapshot-login.mjs';

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
