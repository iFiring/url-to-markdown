import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { PIXEL_PNG } from '../helpers/assets.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const sigScriptPath = path.resolve(thisDir, '../../script/lib/page-element-signature.js');

test('page-element-signature.js: 文件存在且包含 __u2mElementSignature 函数', () => {
  const src = fs.readFileSync(sigScriptPath, 'utf8');
  assert.ok(src.includes('function __u2mElementSignature'), '应定义 __u2mElementSignature');
});

test('page-element-signature.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(sigScriptPath, 'utf8');
  const wrapped = `(${src})(["1"])`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('screenshot_trans.mjs: 无参数时输出 usage_error', async () => {
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

// 步骤 1 产物：全保真快照——真实文本（占位符只存在于步骤 2 派生视图）。
// 模块带单传祖先链：[9]（无样式外层包裹，占满 body 宽）→ [10]（带背景/
// 边框的模块容器，被 9 的 padding 收窄）→ [11]/[12] 内部装饰。
// 链上 9 比 10 宽 → 择优应选 9 的截图。
// --url 指向死端口 → 步骤 8 的 live 重渲染即时失败（ECONNREFUSED），
// 离线走快照兜底
const SNAPSHOT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>测试</title><base data-u2m-base="1" href="http://127.0.0.1:9/dead"></head><body>
<h1 data-u2m-id="1">标题</h1>
<p data-u2m-id="2">段落一文本内容</p>
<div data-u2m-id="9" style="padding: 24px">
<div data-u2m-id="10" style="background-color: rgb(240, 240, 240); border: 1px solid rgb(200, 200, 200); padding: 16px">
<div data-u2m-id="11" style="background-color: rgb(255, 255, 255); padding: 8px">
<span data-u2m-id="12">重要内容</span>
</div>
</div>
</div>
<p data-u2m-id="20">段落二文本内容</p>
</body></html>`;

// 内层宽于外层：30（width:300 含 padding）内嵌 31（width:900 溢出）→
// 宽度优先于最外层，择优选 31
const SNAPSHOT_INNER_WIDER = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>测试</title><base data-u2m-base="1" href="http://127.0.0.1:9/dead"></head><body>
<div data-u2m-id="30" style="width: 300px; padding: 8px">
<div data-u2m-id="31" style="width: 900px; background-color: rgb(240, 240, 240)">加宽内容文本</div>
</div>
</body></html>`;

// 同宽同高：40/41 均占满 body 内容宽、高度一致 → 平局选最外层 40
const SNAPSHOT_TIE = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>测试</title><base data-u2m-base="1" href="http://127.0.0.1:9/dead"></head><body>
<div data-u2m-id="40"><div data-u2m-id="41" style="background-color: rgb(240, 240, 240)">同宽文本</div></div>
</body></html>`;

// 新契约：value 自带行外语法；trans2img 为单传祖先链 ID 数组
const SKELETON = [
  { h1: '# 标题' },
  { p: '{{LONG_TEXT_5}}' },
  { trans2img: [9, 10] },
  { p: '{{LONG_TEXT_8}}' },
];

const LONG_TEXT = {
  '5': '段落一文本内容',
  '6': '重要内容',
  '8': '段落二文本内容',
};

// 死端口 URL：live 重渲染即时失败；其派生目录名与测试预置目录一致
const LIVE_URL = 'http://127.0.0.1:9/test-sstrans';

function setupTmp(name, { snapshot = SNAPSHOT, skeleton = SKELETON, longText = LONG_TEXT } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-sstrans-${name}-`));
  const urlDir = path.join(tmpRoot, urlToDirName(LIVE_URL));
  const assetsDir = path.join(urlDir, 'assets');
  fs.mkdirSync(urlDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });
  if (snapshot !== null) fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), snapshot);
  if (skeleton !== null) fs.writeFileSync(path.join(urlDir, '7_skeleton.json'), JSON.stringify(skeleton));
  if (longText !== null) fs.writeFileSync(path.join(urlDir, '2_long_text.json'), JSON.stringify(longText));
  return { tmpRoot, urlDir, assetsDir };
}

test('screenshot_trans.mjs: live 不可达时快照兜底截图 + resolved skeleton + source 字段', async () => {
  const { tmpRoot, urlDir, assetsDir } = setupTmp('ok');
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.count, 2, '链上每个 id 各截一张（9、10）');
  assert.equal(out.source, 'snapshot', 'live 重渲染失败（死端口）应整体走快照兜底');
  assert.equal(out.resolvedSkeleton, path.join(urlDir, '8_resolved_skeleton.json'));

  // 链上所有截图文件存在且为 WebP
  for (const id of [9, 10]) {
    const imgPath = path.join(assetsDir, 'trans', `${id}.webp`);
    assert.ok(fs.existsSync(imgPath), `截图应存在: ${imgPath}`);
    const stat = fs.statSync(imgPath);
    assert.ok(stat.size > 100, `截图应非空: ${imgPath} ${stat.size} bytes`);
    const buf = fs.readFileSync(imgPath);
    assert.equal(buf.toString('ascii', 0, 4), 'RIFF', 'WebP RIFF header');
    assert.equal(buf.toString('ascii', 8, 12), 'WEBP', 'WebP WEBP signature');
  }

  // resolved skeleton：占位符全部还原；trans2img 择优回写为选中路径
  // （外层 9 占满 body 宽 > 被其 padding 收窄的 10 → 选 9）
  const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
  assert.deepEqual(resolved, [
    { h1: '# 标题' },
    { p: '段落一文本内容' },
    { trans2img: 'assets/trans/9.webp' },
    { p: '段落二文本内容' },
  ], 'resolved skeleton 应还原占位符并把 trans2img 回写为择优路径');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: 择优按宽度优先——内层更宽时选内层', async () => {
  const { tmpRoot, urlDir } = setupTmp('innerwider', {
    snapshot: SNAPSHOT_INNER_WIDER,
    skeleton: [{ trans2img: [30, 31] }],
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.count, 2);

  const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
  assert.deepEqual(resolved, [{ trans2img: 'assets/trans/31.webp' }],
    '内层 31（900px）宽于外层 30（316px）→ 选 31');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: 宽高全同的平局选最外层', async () => {
  const { tmpRoot, urlDir } = setupTmp('tie', {
    snapshot: SNAPSHOT_TIE,
    skeleton: [{ trans2img: [40, 41] }],
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.count, 2);

  const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
  assert.deepEqual(resolved, [{ trans2img: 'assets/trans/40.webp' }],
    '40/41 宽高一致 → 选数组首位（最外层）40');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: trans2img value 非法（旧格式/空数组/非整数）时报 error', async () => {
  const script = path.resolve('script/screenshot_trans.mjs');
  const cases = [
    { name: 'oldstr', skeleton: [{ trans2img: '10' }] },
    { name: 'empty', skeleton: [{ trans2img: [] }] },
    { name: 'nonint', skeleton: [{ trans2img: [9, 'x'] }] },
  ];
  for (const c of cases) {
    const { tmpRoot } = setupTmp(`bad-${c.name}`, { skeleton: c.skeleton });
    const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
      env: { U2M_WORKING_ROOT: tmpRoot },
      timeoutMs: 60000,
    });
    assert.equal(r.code, 1, `${c.name} 应报 error: ${r.stdout}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'error');
    assert.ok(out.reason.includes('trans2img'), `${c.name} reason 应指向 trans2img: ${out.reason}`);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('screenshot_trans.mjs: 无 trans2img 条目时 skipped 但仍输出 resolved skeleton', async () => {
  const { tmpRoot, urlDir, assetsDir } = setupTmp('skip', {
    skeleton: [{ h1: '# 标题' }, { p: '{{LONG_TEXT_5}}' }],
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.skipped, 'no_trans2img');
  assert.ok(!fs.existsSync(path.join(assetsDir, 'trans')), 'skipped 不应创建 trans 目录');

  // skipped 路径也应写出 resolved skeleton
  const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
  assert.deepEqual(resolved, [
    { h1: '# 标题' },
    { p: '段落一文本内容' },
  ], 'skipped 路径也应还原占位符');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: id 在快照也未命中时报 error', async () => {
  const { tmpRoot } = setupTmp('miss', {
    skeleton: [{ trans2img: [999] }],
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('999'), `reason 应含缺失 id: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: code 条目 content 内的占位符同样还原', async () => {
  const { tmpRoot, urlDir } = setupTmp('code', {
    skeleton: [
      { h1: '# 标题' },
      { p: '{{LONG_TEXT_5}}' },
      { code: { lang: 'python', content: '{{LONG_TEXT_6}}' } },
    ],
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.skipped, 'no_trans2img');

  const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
  assert.deepEqual(resolved, [
    { h1: '# 标题' },
    { p: '段落一文本内容' },
    { code: { lang: 'python', content: '重要内容' } },
  ], 'code 对象的 content 占位符应被还原');

  // 步骤 9 端到端：围栏内是还原后的代码，而非字面占位符
  const r9 = await runScript(process.execPath, [path.resolve('script/render_skeleton.mjs'), '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r9.code, 0, `stderr: ${r9.stderr}`);
  const md = fs.readFileSync(path.join(urlDir, '9_markdown.md'), 'utf8');
  assert.ok(md.includes('# 标题'), 'h1 应以 key 重建出 # 前缀');
  assert.ok(md.includes('```python\n重要内容\n```'), '最终 markdown 应含还原后的代码围栏');
  assert.ok(!md.includes('{{LONG_TEXT'), '最终 markdown 不应残留字面占位符');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: code 条目引用未定义编号时报 error', async () => {
  const { tmpRoot } = setupTmp('coderef', {
    skeleton: [{ code: { content: '{{LONG_TEXT_999}}' } }],
    longText: { '5': '其他文本' },
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('999'), `reason 应含未定义编号: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: 缺前置产物时报 error', async () => {
  const script = path.resolve('script/screenshot_trans.mjs');

  // 缺步骤 1（1_snapshot.html）
  const noSnap = setupTmp('nosnap', { snapshot: null });
  const r1 = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: noSnap.tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r1.code, 1);
  assert.ok(JSON.parse(r1.stdout).reason.includes('步骤 1'));
  fs.rmSync(noSnap.tmpRoot, { recursive: true, force: true });

  // 缺步骤 7
  const noSkel = setupTmp('noskel', { skeleton: null });
  const r2 = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: noSkel.tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('步骤 7'));
  fs.rmSync(noSkel.tmpRoot, { recursive: true, force: true });

  // 缺 2_long_text.json
  const noLt = setupTmp('nolt', { longText: null });
  const r3 = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: noLt.tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r3.code, 1);
  assert.ok(JSON.parse(r3.stdout).reason.includes('步骤 2'));
  fs.rmSync(noLt.tmpRoot, { recursive: true, force: true });
});

// ── 图片下载（assets/images/）──

/** 图片夹具服务器：/Dir/cover.png、/other/cover.png、/pic（无扩展名）、/missing.png（404）。 */
function startImageServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/missing.png') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const ct = req.url === '/pic.svg' ? 'image/svg+xml' : 'image/png';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(PIXEL_PNG);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () =>
    resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}

test('screenshot_trans.mjs: img 条目下载到 assets/images/（解包 ![img](url)、冲突编号、同 URL 去重、失败保留原值）', async () => {
  const srv = await startImageServer();
  const { tmpRoot, urlDir, assetsDir } = setupTmp('imgs', {
    skeleton: [
      { h1: '# 标题' },
      { img: `![img](${srv.base}/Dir/cover.png)` },
      { img: `![img](${srv.base}/other/cover.png)` },
      { img: `![img](${srv.base}/Dir/cover.png)` },
      { img: `![img](${srv.base}/pic.svg)` },
      { img: `![img](${srv.base}/missing.png)` },
      { p: '{{LONG_TEXT_5}}' },
    ],
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  try {
    const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
      env: { U2M_WORKING_ROOT: tmpRoot },
      timeoutMs: 60000,
    });
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'ok');
    assert.equal(out.skipped, 'no_trans2img', '无 trans2img 仍应 skipped');
    assert.equal(out.images, 3, '应成功下载 3 张（同 URL 去重后）');
    assert.deepEqual(out.failedImages, [`${srv.base}/missing.png`], '失败 URL 列入 failedImages');

    // 落盘文件：原名、冲突编号、content-type 定扩展名
    const imagesDir = path.join(assetsDir, 'images');
    assert.deepEqual(fs.readdirSync(imagesDir).sort(), ['cover-1.png', 'cover.png', 'pic.svg']);
    assert.equal(fs.readFileSync(path.join(imagesDir, 'cover.png')).toString('base64'),
      PIXEL_PNG.toString('base64'), '内容应为服务器返回的字节');

    // resolved skeleton：成功条目只换括号内 URL、保留 ![img] 形态，失败条目保留原值
    const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
    assert.deepEqual(resolved, [
      { h1: '# 标题' },
      { img: '![img](assets/images/cover.png)' },
      { img: '![img](assets/images/cover-1.png)' },
      { img: '![img](assets/images/cover.png)' },
      { img: '![img](assets/images/pic.svg)' },
      { img: `![img](${srv.base}/missing.png)` },
      { p: '段落一文本内容' },
    ], '成功下载的 img 应改写为本地路径（保留 alt），失败保留原值');

    // 步骤 9 直接可渲染
    const r9 = await runScript(process.execPath, [path.resolve('script/render_skeleton.mjs'), '--url', LIVE_URL], {
      env: { U2M_WORKING_ROOT: tmpRoot },
      timeoutMs: 30000,
    });
    assert.equal(r9.code, 0, `stderr: ${r9.stderr}`);
    const md = fs.readFileSync(path.join(urlDir, '9_markdown.md'), 'utf8');
    assert.ok(md.includes('![img](assets/images/cover.png)'), 'markdown 应引用本地图片');
    assert.ok(md.includes(`![img](${srv.base}/missing.png)`), '失败图片保留远端引用');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    await srv.close();
  }
});

test('screenshot_trans.mjs: trans2img 与 img 混合时截图、下载同轮完成', async () => {
  const srv = await startImageServer();
  const { tmpRoot, urlDir, assetsDir } = setupTmp('mix', {
    skeleton: [
      { img: `![img](${srv.base}/Dir/cover.png)` },
      { p: '{{LONG_TEXT_5}}' },
      { trans2img: [9, 10] },
    ],
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  try {
    const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
      env: { U2M_WORKING_ROOT: tmpRoot },
      timeoutMs: 60000,
    });
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'ok');
    assert.equal(out.count, 2, 'trans2img 链上 9、10 各截 1 张');
    assert.equal(out.source, 'snapshot', '死端口 --url 下混合用例同样走快照兜底');
    assert.equal(out.images, 1, '下载 1 张');
    assert.ok(fs.existsSync(path.join(assetsDir, 'trans', '9.webp')), '外层截图应存在');
    assert.ok(fs.existsSync(path.join(assetsDir, 'trans', '10.webp')), '模块容器截图应存在');
    assert.ok(fs.existsSync(path.join(assetsDir, 'images', 'cover.png')), '下载应存在');

    const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
    assert.equal(resolved[0].img, '![img](assets/images/cover.png)');
    assert.deepEqual(resolved[2], { trans2img: 'assets/trans/9.webp' }, 'trans2img 择优回写选中路径');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    await srv.close();
  }
});
