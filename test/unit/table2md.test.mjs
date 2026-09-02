import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertTables } from '../../script/lib/table2md.js';

test('convertTables：成功表存 markdown、失败表存 reason + 日志', async () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-t2m-'));
  const list = [
    { k: 1, dataIdx: '100', outerHTML: `<table><thead><tr><th>S</th><th>I</th></tr></thead><tbody><tr><td>m</td><td>L</td></tr></tbody></table>`, rows: 2, cols: 2 },
    { k: 2, dataIdx: '200', outerHTML: `<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>`, rows: 1, cols: 2 }, // 无 th
  ];
  const { tables, counts } = await convertTables(list, { engine: 'self', longTextMap: {}, logsDir });
  assert.equal(counts.total, 2);
  assert.equal(counts.ok, 1);
  assert.equal(counts.failed, 1);
  assert.equal(tables['1'].status, 'ok');
  assert.match(tables['1'].markdown, /\| S \| I \|/);
  assert.equal(tables['2'].status, 'failed');
  assert.equal(tables['2'].markdown, null);
  assert.match(tables['2'].reason, /no.*header/i);
  const logFiles = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log'));
  assert.ok(logFiles.some((f) => f.includes('2_200')), '失败表落日志');
  fs.rmSync(logsDir, { recursive: true, force: true });
});

test('convertTables：预展开表内 {{LONG_TEXT_k|n_chars}} → 原文', async () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-t2m-'));
  const list = [{ k: 1, dataIdx: '10', rows: 2, cols: 1,
    outerHTML: `<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>{{LONG_TEXT_3|8_chars}}</td></tr></tbody></table>` }];
  const longTextMap = { '3': '长文本原文' };
  const { tables } = await convertTables(list, { engine: 'self', longTextMap, logsDir });
  assert.equal(tables['1'].status, 'ok');
  assert.match(tables['1'].markdown, /长文本原文/);
  fs.rmSync(logsDir, { recursive: true, force: true });
});

test('convertTables：engine 选 turndown', async () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-t2m-'));
  const list = [{ k: 1, dataIdx: '1', rows: 2, cols: 1,
    outerHTML: `<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>` }];
  const { tables } = await convertTables(list, { engine: 'turndown', longTextMap: {}, logsDir });
  assert.equal(tables['1'].status, 'ok');
  assert.equal(tables['1'].engine, 'turndown');
  fs.rmSync(logsDir, { recursive: true, force: true });
});
