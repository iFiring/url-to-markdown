import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-clean-snapshot.js');

function runInBrowser(html, fnSrc) {
  // 用 node 模拟浏览器环境：使用 jsdom 或直接字符串处理验证
  // 这里验证函数源码是否合法
  const wrapped = `(${fnSrc})()`;
  // 基础语法检查
  assert.doesNotThrow(() => new Function('return ' + wrapped), '页面函数应为合法 JS');
}

test('page-clean-snapshot.js: 文件存在且包含 __u2mCleanSnapshot 函数', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('function __u2mCleanSnapshot'), '应定义 __u2mCleanSnapshot');
});

test('page-clean-snapshot.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const wrapped = `(${src})()`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('clean_snapshot.mjs: 无参数时输出 usage_error', async () => {
  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('clean_snapshot.mjs: 对 article-1 快照执行清洗', async () => {
  // 准备临时目录，手动放入一个测试快照
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-'));
  const urlDir = path.join(tmpRoot, 'test-article');
  const stepsDir = path.join(urlDir, 'steps');
  fs.mkdirSync(stepsDir, { recursive: true });

  // 用 article-1.html 作为模拟快照
  const fixture = fs.readFileSync(path.resolve('test/fixtures/article-1.html'), 'utf8');
  fs.writeFileSync(path.join(stepsDir, '1_snapshot.html'), fixture);

  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  // 验证清洗结果
  const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');
  assert.ok(!cleaned.includes('style='), '不应含 style 属性');
  assert.ok(!cleaned.includes('<style'), '不应含 <style> 标签');
  assert.ok(cleaned.includes('LONG_TEXT'), '应含长文本占位符');
  assert.ok(!cleaned.match(/<svg[^>]+[a-z-]+=/i), 'SVG 不应有属性');

  // head 里的 meta/link（charset/viewport/preconnect/og:* 等）对步骤 3 的结构识别
  // 是纯噪声，全部删除；title 保留作识别线索
  assert.ok(!cleaned.includes('<meta'), '不应含 <meta> 标签');
  assert.ok(!cleaned.includes('<link'), '不应含 <link> 标签');
  assert.ok(cleaned.includes('<title>'), '应保留 <title>');

  // 清理
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('clean_snapshot.mjs: 纯空白文本节点（缩进）不占位', async () => {
  // 回归：父元素开标签与子元素之间的缩进空白（>16 字符）曾被占位成
  // {{LONG_TEXT_k|N_CHARS}}，凭空给步骤 3 的 LLM 捏造"父子之间存在长文本"。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-ws-'));
  const urlDir = path.join(tmpRoot, 'ws-article');
  const stepsDir = path.join(urlDir, 'steps');
  fs.mkdirSync(stepsDir, { recursive: true });

  // 21 字符的纯空白（换行+缩进）夹在父开标签与子元素之间；
  // 另放一段真实长文本作对照（应正常占位）
  const ws = '\n' + ' '.repeat(20);
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div id="root" data-u2m-id="1">${ws}<div data-u2m-id="2">这是一段真实存在的长文本内容，用来对照占位行为。</div>${ws}<div data-u2m-id="3"></div>
  </div>
</body></html>`;
  fs.writeFileSync(path.join(stepsDir, '1_snapshot.html'), snapshot);

  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  // 只有真实长文本被占位，纯空白不计入
  assert.equal(out.longTextCount, 1, '仅真实长文本应被占位，缩进空白不应计数');

  const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');
  const between = cleaned.match(/data-u2m-id="1">([\s\S]*?)<div data-u2m-id="2"/);
  assert.ok(between, '应能找到父元素与第一个子元素之间的片段');
  assert.ok(!between[1].includes('LONG_TEXT'), '父子之间的缩进空白不应变成占位符');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
