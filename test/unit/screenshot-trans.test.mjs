import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { PIXEL_PNG } from '../helpers/assets.mjs';
import { pixelStats, closePixelStats } from '../helpers/pixel-stats.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const sigScriptPath = path.resolve(thisDir, '../../script/lib/page-element-signature.js');
const revealScriptPath = path.resolve(thisDir, '../../script/lib/page-reveal-hidden.js');

test('page-element-signature.js: 文件存在且包含 __u2mElementSignature 函数', () => {
  const src = fs.readFileSync(sigScriptPath, 'utf8');
  assert.ok(src.includes('function __u2mElementSignature'), '应定义 __u2mElementSignature');
});

test('page-element-signature.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(sigScriptPath, 'utf8');
  const wrapped = `(${src})(["1"])`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('page-reveal-hidden.js: 文件存在且包含 __u2mRevealHidden 函数', () => {
  const src = fs.readFileSync(revealScriptPath, 'utf8');
  assert.ok(src.includes('function __u2mRevealHidden'), '应定义 __u2mRevealHidden');
});

test('page-reveal-hidden.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(revealScriptPath, 'utf8');
  const wrapped = `(${src})(1)`;
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
<h1 data-idx="1">标题</h1>
<p data-idx="2">段落一文本内容</p>
<div data-idx="9" style="padding: 24px">
<div data-idx="10" style="background-color: rgb(240, 240, 240); border: 1px solid rgb(200, 200, 200); padding: 16px">
<div data-idx="11" style="background-color: rgb(255, 255, 255); padding: 8px">
<span data-idx="12">重要内容</span>
</div>
</div>
</div>
<p data-idx="20">段落二文本内容</p>
</body></html>`;

// 内层宽于外层：30（width:300 含 padding）内嵌 31（width:900 溢出）→
// 宽度优先于最外层，择优选 31
const SNAPSHOT_INNER_WIDER = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>测试</title><base data-u2m-base="1" href="http://127.0.0.1:9/dead"></head><body>
<div data-idx="30" style="width: 300px; padding: 8px">
<div data-idx="31" style="width: 900px; background-color: rgb(240, 240, 240)">加宽内容文本</div>
</div>
</body></html>`;

// 同宽同高：40/41 均占满 body 内容宽、高度一致 → 平局选最外层 40
const SNAPSHOT_TIE = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>测试</title><base data-u2m-base="1" href="http://127.0.0.1:9/dead"></head><body>
<div data-idx="40"><div data-idx="41" style="background-color: rgb(240, 240, 240)">同宽文本</div></div>
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

// 步骤 3 产物默认值（四键契约）：与基础 SNAPSHOT 的正文对应（标题 1、
// 块 2/20）。其余夹具按各自快照传覆盖值；trans2img id 由 CLI 自行并入
// keep 集。
const KEY_IDS = { titleId: 1, descriptionIds: [], paragraphIds: [2, 20], dumpIds: [] };

function setupTmp(name, { snapshot = SNAPSHOT, skeleton = SKELETON, longText = LONG_TEXT, keyIds = KEY_IDS } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-sstrans-${name}-`));
  const urlDir = path.join(tmpRoot, urlToDirName(LIVE_URL));
  const assetsDir = path.join(urlDir, 'assets');
  fs.mkdirSync(urlDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });
  if (snapshot !== null) fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), snapshot);
  if (skeleton !== null) fs.writeFileSync(path.join(urlDir, '7_skeleton.json'), JSON.stringify(skeleton));
  if (longText !== null) fs.writeFileSync(path.join(urlDir, '2_long_text.json'), JSON.stringify(longText));
  if (keyIds !== null) fs.writeFileSync(path.join(urlDir, '3_key_ids.json'), JSON.stringify(keyIds));
  return { tmpRoot, urlDir, assetsDir };
}

test('screenshot_trans.mjs: live 不可达时快照兜底截图 + resolved skeleton + source 字段', async () => {
  const { tmpRoot, urlDir, assetsDir } = setupTmp('ok');
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot, U2M_DEBUG: '1' },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.count, 2, '链上每个 id 各截一张（9、10）');

  // 分类层 keep 集 = titleId 1 ∪ 块 2/20 ∪ trans2img 9/10——五个 id 全部
  // 命中（live 死端口 → 仅快照页执行一次分类层排除）。keep 集漏键（如仍
  // 读旧五键）时正文 id 被 visibility 隐藏、keep 命中数缩水
  const keepLines = r.stderr.split('\n').filter((l) => l.includes('分类层排除'));
  assert.ok(keepLines.some((l) => /keep 命中 5$/.test(l)),
    `keep 集应命中全部四键内容 id + trans id（分类层调试行: ${keepLines.join(' | ') || '无'}）`);
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
    keyIds: { titleId: null, descriptionIds: [], paragraphIds: [31], dumpIds: [] },
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
    keyIds: { titleId: null, descriptionIds: [], paragraphIds: [41], dumpIds: [] },
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

// 手风琴折叠模块：站点 CSS 把 .body 折叠为 display:none——快照（样式内联）
// 与 live 重渲染同为隐藏态。链上 50（手风琴项，含可见按钮）自身有盒、
// 51（折叠 body）/52（模块）无布局盒。隐藏模块是步骤 2 检测、带样式版
// 保真流到步骤 7 的合法 trans2img 标记——步骤 8 必须强制展开出图，
// 而不是 el.screenshot() 等可见 30s 超时把整次转换打成 error
const SNAPSHOT_ACCORDION = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>折叠模块</title><base data-u2m-base="1" href="http://127.0.0.1:9/dead">
<style>.acc .body { display: none; }</style></head><body>
<h1 data-idx="1">标题</h1>
<div class="acc" data-idx="50">
<button data-idx="53">展开</button>
<div class="body" data-idx="51"><div data-idx="52" style="background-color: rgb(30, 30, 30); color: rgb(255, 255, 255); padding: 16px"><p>折叠模块段落一。</p><p>折叠模块段落二。</p></div></div>
</div>
<p data-idx="60">结尾段落。</p>
</body></html>`;

// max-height:0 裁剪形态：71 盒高为 0，72（模块）盒正常但像素被祖先裁掉——
// 不展开就截是空白图。展开后 71/72 等宽等高 → 平局选最外层 71
const SNAPSHOT_MAXHEIGHT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>裁剪模块</title><base data-u2m-base="1" href="http://127.0.0.1:9/dead">
<style>.mh { max-height: 0; overflow: hidden; }</style></head><body>
<h1 data-idx="1">标题</h1>
<div class="mh" data-idx="71"><div data-idx="72" style="background-color: rgb(30, 30, 30); color: rgb(255, 255, 255); padding: 16px"><p>被裁剪的模块内容。</p></div></div>
<p data-idx="60">结尾段落。</p>
</body></html>`;

test('screenshot_trans.mjs: display:none 折叠模块强制展开后出图，不再挂死 error', async () => {
  const { tmpRoot, urlDir, assetsDir } = setupTmp('accordion', {
    snapshot: SNAPSHOT_ACCORDION,
    skeleton: [{ trans2img: [50, 51, 52] }],
    keyIds: { titleId: 1, descriptionIds: [], paragraphIds: [60], dumpIds: [] },
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 120000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.count, 3, '链上三个 id（含折叠的 51/52）各出一张');
  assert.equal(out.source, 'snapshot', 'live 不可达（死端口）→ 快照兜底');

  for (const id of [50, 51, 52]) {
    const imgPath = path.join(assetsDir, 'trans', `${id}.webp`);
    assert.ok(fs.existsSync(imgPath), `截图应存在: ${imgPath}`);
    const stat = fs.statSync(imgPath);
    assert.ok(stat.size > 100, `截图应非空: ${imgPath} ${stat.size} bytes`);
    const buf = fs.readFileSync(imgPath);
    assert.equal(buf.toString('ascii', 0, 4), 'RIFF', 'WebP RIFF header');
    assert.equal(buf.toString('ascii', 8, 12), 'WEBP', 'WebP WEBP signature');
  }

  // 择优：展开只发生在各 id 自己截图前、方向向上——50 截图时折叠的 51
  // 尚未展开（盒 = 按钮高度），51/52 展开后等高且更高 → 等宽选高选 51
  // （展开的内容包装，不含展开按钮，恰是模块语义主体）
  const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
  assert.deepEqual(resolved, [{ trans2img: 'assets/trans/51.webp' }],
    '折叠链强制展开后择优应回写路径（等宽选高 → 51）');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: max-height:0 裁剪模块强制展开后出真实内容，而非空白图', async () => {
  const { tmpRoot, urlDir, assetsDir } = setupTmp('maxheight', {
    snapshot: SNAPSHOT_MAXHEIGHT,
    skeleton: [{ trans2img: [71, 72] }],
    keyIds: { titleId: 1, descriptionIds: [], paragraphIds: [60], dumpIds: [] },
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 120000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.count, 2, '链上两个 id（含盒高为 0 的 71）各出一张');

  for (const id of [71, 72]) {
    const imgPath = path.join(assetsDir, 'trans', `${id}.webp`);
    assert.ok(fs.existsSync(imgPath), `截图应存在: ${imgPath}`);
    const stat = fs.statSync(imgPath);
    assert.ok(stat.size > 100, `截图应非空: ${imgPath} ${stat.size} bytes`);
  }

  // 展开后 71/72 等宽等高 → 平局选最外层 71
  const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
  assert.deepEqual(resolved, [{ trans2img: 'assets/trans/71.webp' }],
    '裁剪链强制展开后择优应回写路径（全同选最外层 → 71）');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// display:contents 透明包装（真实 OpenAI 文档形态）：规范上永不生成盒——
// 自身截不出图是结构性的，不是隐藏。视觉由链上内层模块承载：应跳过
// contents id、只截内层，择优自然选中内层，而不是整个 run 报错
const SNAPSHOT_CONTENTS = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>透明包装</title><base data-u2m-base="1" href="http://127.0.0.1:9/dead">
<style>.expn .body { display: none; }</style></head><body>
<h1 data-idx="1">标题</h1>
<div class="expn" data-idx="80">
<button data-idx="81">展开</button>
<div class="body" data-idx="82"><div style="display: contents" data-idx="83"><div data-idx="84" style="background-color: rgb(30, 30, 30); color: rgb(255, 255, 255); padding: 16px"><p>透明包装内的模块内容。</p></div></div></div>
</div>
<p data-idx="60">结尾段落。</p>
</body></html>`;

test('screenshot_trans.mjs: display:contents 透明包装跳过不报错，视觉由链上内层承载', async () => {
  const { tmpRoot, urlDir, assetsDir } = setupTmp('contents', {
    snapshot: SNAPSHOT_CONTENTS,
    skeleton: [{ trans2img: [83, 84] }],
    keyIds: { titleId: 1, descriptionIds: [], paragraphIds: [60], dumpIds: [] },
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 120000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.count, 1, '只截内层 84（83 为 contents 结构性无盒）');

  const imgPath = path.join(assetsDir, 'trans', '84.webp');
  assert.ok(fs.existsSync(imgPath), `内层截图应存在: ${imgPath}`);
  assert.ok(!fs.existsSync(path.join(assetsDir, 'trans', '83.webp')), 'contents id 不应产出截图');

  const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
  assert.deepEqual(resolved, [{ trans2img: 'assets/trans/84.webp' }],
    '择优只能落在真实出图的 84 上');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: 条目全部 id 结构性无盒时报 error 指明条目', async () => {
  const { tmpRoot } = setupTmp('contents-only', {
    snapshot: SNAPSHOT_CONTENTS,
    skeleton: [{ trans2img: [83] }],
    keyIds: { titleId: 1, descriptionIds: [], paragraphIds: [60], dumpIds: [] },
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 120000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('83'), `reason 应含条目 id: ${out.reason}`);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── 超宽裁剪 + 遮挡（spec §5 超宽裁剪夹具）──
// 真实盒裁剪形态：html{overflow-x:auto} 让 body 的 overflow-x:hidden 作为
// 普通盒裁剪（视口传播形态测不到 bug，见 spec §1）；.wrap 再叠一层
// overflow-x:auto（宽表格站点的标准写法）。表 2800px 超视口（1280）。
// 品红 fixed 假导航×2 横跨表格区域（非亲族 → 遮挡者隐藏）；
// 红徽标在表内（亲族 absolute → 保留）；非 fixed 的 relative 负 margin
// 橙色重叠块压在表上（未打标——分类层盲视，仅几何层泛化相交规则可藏）
const wideCells = (bg) =>
  `<td style="width: 100px; height: 40px; border: 1px solid rgb(120, 120, 120); background: ${bg}">cell</td>`.repeat(28);
const SNAPSHOT_WIDE = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>超宽</title><base data-u2m-base="1" href="http://127.0.0.1:9/dead">
<style>
  html { overflow-x: auto; }
  body { overflow-x: hidden; margin: 0; }
  .wrap { overflow-x: auto; max-width: 640px; }
</style></head><body>
<h1 data-idx="1">超宽模块测试</h1>
<p data-idx="2">正文段落。</p>
<div data-idx="97" style="position: absolute; top: 160px; right: 0; width: 120px; height: 400px; background: rgb(75, 0, 130); z-index: 100"></div>
<div style="position: fixed; top: 0; left: 0; width: 40px; height: 100%; background: rgb(255, 0, 255); z-index: 9999"></div>
<div style="position: fixed; top: 0; right: 0; width: 40px; height: 100%; background: rgb(255, 0, 255); z-index: 9999"></div>
<div class="wrap" data-idx="91">
<table data-idx="92" style="width: 2800px; border-collapse: collapse; background: rgb(255, 255, 255)">
<tr>${wideCells('rgb(200, 220, 240)')}</tr>
<tr>${wideCells('rgb(225, 235, 250)')}</tr>
<tr>${wideCells('rgb(200, 220, 240)')}</tr>
<tr><td colspan="28" style="height: 40px; border: 1px solid rgb(120, 120, 120); background: rgb(200, 220, 240)"><div data-idx="98" style="height: 40px; background: rgb(0, 255, 255)">广告位</div></td></tr>
<tr><td colspan="28" style="height: 40px; border: 1px solid rgb(120, 120, 120); background: rgb(225, 235, 250)"><span data-idx="95" style="position: absolute; top: 200px; left: 300px; width: 60px; height: 60px; background: rgb(255, 0, 0); z-index: 9999"></span></td></tr>
</table>
</div>
<div style="position: relative; margin-top: -120px; height: 60px; background: rgb(255, 165, 0); z-index: 50"></div>
<p data-idx="60">结尾段落。</p>
</body></html>`;

test('screenshot_trans.mjs: 超宽表格横向 reveal 截全 + 遮挡者隐藏 + 亲族保留', async () => {
  const { tmpRoot, urlDir, assetsDir } = setupTmp('wide', {
    snapshot: SNAPSHOT_WIDE,
    skeleton: [{ trans2img: [91, 92] }],
    keyIds: { titleId: 1, descriptionIds: [], paragraphIds: [2, 60], dumpIds: [98] },
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  try {
    const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
      env: { U2M_WORKING_ROOT: tmpRoot },
      timeoutMs: 120000,
    });
    assert.equal(r.code, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'ok');
    assert.equal(out.count, 2, '链上 91、92 各截一张');
    assert.equal(out.source, 'snapshot', '死端口 → 快照兜底');

    const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
    assert.deepEqual(resolved, [{ trans2img: 'assets/trans/92.webp' }],
      '表格 2800px 宽于 wrap 640px → 择优选 92');

    const s = await pixelStats(path.join(assetsDir, 'trans', '92.webp'), [
      { name: 'beyondDensity', kind: 'density', rect: [2600, 0, 99999, 99999] },
      { name: 'magenta', kind: 'count', rgb: [255, 0, 255] },
      { name: 'red', kind: 'count', rgb: [255, 0, 0] },
      { name: 'orange', kind: 'count', rgb: [255, 165, 0] },
      { name: 'purple', kind: 'count', rgb: [75, 0, 130] },
      { name: 'cyan', kind: 'count', rgb: [0, 255, 255] },
    ]);
    assert.equal(s.width, 5680, `2800+40 留白 CSS × 2 应截全: ${s.width}`);
    assert.ok(s.beyondDensity > 0.01, `超视口带（x≥2600 设备px）内容密度>1%: ${s.beyondDensity}`);
    assert.equal(s.magenta, 0, `非亲族 fixed 导航应隐藏: ${s.magenta}`);
    assert.ok(s.red > 1000, `亲族红徽标应保留: ${s.red}`);
    assert.equal(s.orange, 0, `relative 负 margin 重叠块应隐藏: ${s.orange}`);
    assert.equal(s.purple, 0, `非内容侧栏（双层共同路径）应隐藏: ${s.purple}`);
    assert.equal(s.cyan, 0, `keep 子树内 delete 噪音（分类层独有路径）应隐藏: ${s.cyan}`);
  } finally {
    await closePixelStats();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
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

test('screenshot_trans.mjs: 3_key_ids.json 非四键契约时报 error（旧五键文件/键重叠/非法成员）', async () => {
  const script = path.resolve('script/screenshot_trans.mjs');
  const cases = [
    // 旧五键文件：无 paragraphIds → 拒收并指回步骤 3
    { name: 'oldfive', keyIds: { titleIds: [1], descriptionIds: [], standaloneIds: [], listFlowIds: [2, 20], listFlowDeleteIds: [] }, match: 'paragraphIds' },
    // titleId 与段落块重叠：四键互不相交
    { name: 'overlap', keyIds: { titleId: 5, descriptionIds: [], paragraphIds: [5, 20], dumpIds: [] }, match: '重叠' },
    // paragraphIds 非法成员：块 ID 应为正整数
    { name: 'badmember', keyIds: { titleId: 1, descriptionIds: [], paragraphIds: [2, 'x'], dumpIds: [] }, match: '非法成员' },
  ];
  for (const c of cases) {
    const { tmpRoot } = setupTmp(`badkeys-${c.name}`, { keyIds: c.keyIds });
    const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
      env: { U2M_WORKING_ROOT: tmpRoot },
      timeoutMs: 60000,
    });
    assert.equal(r.code, 1, `${c.name} 应报 error: ${r.stdout}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'error');
    assert.ok(out.reason.includes(c.match), `${c.name} reason 应含「${c.match}」: ${out.reason}`);
    assert.ok(out.reason.includes('步骤 3'), `${c.name} reason 应指回步骤 3: ${out.reason}`);
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

  // 缺步骤 3（3_key_ids.json）
  const noKey = setupTmp('nokey', { keyIds: null });
  const r4 = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: noKey.tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r4.code, 1);
  assert.ok(JSON.parse(r4.stdout).reason.includes('步骤 3'));
  fs.rmSync(noKey.tmpRoot, { recursive: true, force: true });
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
