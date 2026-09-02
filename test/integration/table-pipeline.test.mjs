import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

// 1_snapshot 夹具：data-idx 已打（步骤 1 产物形态），三张表 + 正文。
const SNAPSHOT = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>表格测试</title>
<style>th,td{border:1px solid #999;padding:6px}thead th{background:#eef}</style></head>
<body>
  <h1 data-idx="1">表格测试</h1>
  <p data-idx="2">简单 2 列表：</p>
  <table data-idx="3">
    <thead><tr><th>Setting</th><th>Impact</th></tr></thead>
    <tbody><tr><td>model</td><td>大</td></tr><tr><td>temperature</td><td>中</td></tr></tbody>
  </table>
  <p data-idx="4">跨行跨列表：</p>
  <table data-idx="5">
    <thead>
      <tr><th rowspan="2">时间</th><th colspan="2">上午</th></tr>
      <tr><th>第1节</th><th>第2节</th></tr>
    </thead>
    <tbody>
      <tr><td rowspan="2">周一</td><td>语文</td><td>数学</td></tr>
      <tr><td>物理</td><td>化学</td></tr>
    </tbody>
  </table>
  <p data-idx="6">无表头表：</p>
  <table data-idx="7">
    <tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody>
  </table>
</body></html>`;

async function runClean(tmpRoot, url, env = {}) {
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), SNAPSHOT);
  const r = await runScript(process.execPath, [path.resolve('script/clean_snapshot.mjs'), '--url', url],
    { env: { ...env, U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  return { r, dir };
}

test('表格管线：步骤 2 产 2_tables.json + logs，成功/失败计数正确', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-integ-table-'));
  const url = 'https://example.com/tables';
  const { r, dir } = await runClean(tmpRoot, url, { U2M_TABLE_ENGINE: 'self' });
  try {
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.tables.total, 3);
    assert.equal(out.tables.ok, 2, '简单表 + 跨行跨列表成功');
    assert.equal(out.tables.failed, 1, '无表头表失败');
    assert.ok(fs.existsSync(path.join(dir, '2_tables.json')));
    const tj = JSON.parse(fs.readFileSync(path.join(dir, '2_tables.json'), 'utf8'));
    // 跨行跨列表（k=2）成功、3 列（时间 + 上午 colspan2 = 3 列）
    assert.equal(tj['2'].status, 'ok');
    assert.equal(tj['2'].cols, 3);
    // 失败诊断日志
    assert.ok(fs.readdirSync(path.join(dir, 'logs', 'tables')).length >= 1);
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
});

test('表格管线：成功表 styled 折叠、失败表 styled 保 live + data-u2m-table=fail', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-integ-table-'));
  const url = 'https://example.com/tables';
  const { r, dir } = await runClean(tmpRoot, url, { U2M_TABLE_ENGINE: 'self' });
  try {
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    const styled = fs.readFileSync(out.styledSnapshot, 'utf8');
    const okCount = (styled.match(/\{\{TABLE_\d+\|\d+×\d+\}\}/g) || []).length;
    assert.equal(okCount, 2, '两成功表折叠');
    assert.match(styled, /data-u2m-table="fail"/, '失败表保 live + 标记');
    // clean 版三表均折叠（恒折叠）
    const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');
    assert.equal((cleaned.match(/\{\{TABLE_\d+\|\d+×\d+\}\}/g) || []).length, 3);
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
});

test('表格管线：步骤 8 {{TABLE_k}} 还原 + 步骤 9 GFM markdown 输出', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-integ-table-'));
  const url = 'https://example.com/tables';
  const { r, dir } = await runClean(tmpRoot, url, { U2M_TABLE_ENGINE: 'self' });
  try {
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    // 注入 3_key_ids（h1=1 标题、p=2 段落块）+ 7_skeleton（模拟步骤 7 LLM）
    fs.writeFileSync(path.join(dir, '3_key_ids.json'),
      JSON.stringify({ titleId: 1, descriptionIds: [], paragraphIds: [2], dumpIds: [] }));
    fs.writeFileSync(path.join(dir, '7_skeleton.json'), JSON.stringify([
      { h1: '# 表格测试' },
      { p: '简单 2 列表：' },
      { table: '{{TABLE_1}}' },
      { p: '跨行跨列表：' },
      { table: '{{TABLE_2}}' },
      { p: '无表头表（落步骤7 自转）：' },
      { table: '| A | B |\n| --- | --- |\n| C | D |' },
    ], null, 2));
    // 步骤 8
    const r8 = await runScript(process.execPath, [path.resolve('script/screenshot_trans.mjs'), '--url', url],
      { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
    assert.equal(r8.code, 0, `stderr: ${r8.stderr}`);
    const out8 = JSON.parse(r8.stdout);
    assert.equal(out8.tablesResolved, 2, '两成功表还原');
    const resolved = JSON.parse(fs.readFileSync(out8.resolvedSkeleton, 'utf8'));
    assert.match(resolved[2].table, /\| Setting \| Impact \|/);
    assert.match(resolved[4].table, /\| 时间 \| 上午 \| 上午 \|/, '跨格表 3 列、上午重复');
    // 步骤 9
    const r9 = await runScript(process.execPath, [path.resolve('script/render_skeleton.mjs'), '--url', url],
      { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
    assert.equal(r9.code, 0, `stderr: ${r9.stderr}`);
    const md = fs.readFileSync(JSON.parse(r9.stdout).markdownPath, 'utf8');
    assert.match(md, /\| Setting \| Impact \|/);
    assert.match(md, /\| 时间 \| 上午 \| 上午 \|/);
    assert.match(md, /\| A \| B \|/, '失败表 LLM 自转 markdown 透传');
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
});
