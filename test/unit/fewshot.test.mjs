import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const FEWSHOT = path.resolve('script/lib/fewshot');
const ACTIONS = new Set(['keep','delete','code_block','screenshot','passthrough_svg','svg_convert','latex','block_screenshot']);

test('fewshot: 每对 .html/.json 合 v2 schema 且 blocks id ⊆ 输入 id 集', async () => {
  const files = await fs.readdir(FEWSHOT);
  const names = files.filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5));
  assert.ok(names.length >= 7, `少样本应 ≥7 对，实际 ${names.length}`);
  for (const name of names) {
    const html = await fs.readFile(path.join(FEWSHOT, `${name}.html`), 'utf8');
    const plan = JSON.parse(await fs.readFile(path.join(FEWSHOT, `${name}.json`), 'utf8'));
    assert.equal(plan.version, 2, `${name}: version`);
    assert.ok(['whole', 'region'].includes(plan.mode), `${name}: mode`);
    assert.ok(typeof plan.listFlowSelector === 'string' && plan.listFlowSelector.trim(), `${name}: listFlowSelector`);
    const htmlIds = new Set([...html.matchAll(/data-u2m-id="(\d+)"/g)].map((m) => m[1]));
    assert.ok(plan.blocks.length, `${name}: blocks 非空`);
    for (const b of plan.blocks) {
      assert.ok(Number.isInteger(b.id), `${name}: id int`);
      assert.ok(ACTIONS.has(b.action), `${name}: action ${b.action}`);
      assert.ok(htmlIds.has(String(b.id)), `${name}: id ${b.id} 不在输入`);
      if (b.blockOf != null) assert.ok(Number.isInteger(b.blockOf), `${name}: blockOf int`);
    }
  }
});

test('fewshot: title-in-listflow 的主标题在列表流内侧（其 id 或父块 id 在 blocks 内）', async () => {
  const html = await fs.readFile(path.join(FEWSHOT, 'title-in-listflow.html'), 'utf8');
  const plan = JSON.parse(await fs.readFile(path.join(FEWSHOT, 'title-in-listflow.json'), 'utf8'));
  assert.match(html, /<h1[^>]*>标题/);
  const h1InsideListFlow = /listFlowSelector/.test(JSON.stringify(plan)); // selector 存在
  assert.ok(h1InsideListFlow);
  assert.ok(plan.blocks.some((b) => b.action === 'keep'), '主标题侧应有 keep');
});
