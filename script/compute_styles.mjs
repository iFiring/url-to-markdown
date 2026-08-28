#!/usr/bin/env node
/**
 * compute_styles.mjs —— 步骤 5：样式内联（juice）。
 * 把 `4_styled_extract.html` 的 `<style>` 规则内联进元素 style 属性，
 * 再按白名单只保留明显结构化的样式（border/outline/background/box-shadow、flex/grid 布局、overflow、transform）与 font-size/font-weight，
 * 删净其余声明及残留 `<style>`/`class`，终态纯内联。
 * 两轮处理细节见脚本头部注释。
 * 内联声明只留有意义的。
 *
 * 用法:
 *   node compute_styles.mjs --url <url>
 *
 * 三段处理：
 *  -1. 隐藏声明剥离（浏览器，lib/page-strip-hidden.js）：收起的元素展开为
 *      可见——CSSOM 删样式表规则与内联 style 的 display:none/
 *      visibility:hidden 声明（只删隐藏声明、规则其余声明保留——
 *      display:flex 等自然布局信号不被 block 盲改），规则集 cssText 写回
 *      <style> 文本（CSSOM 改写不回写文本节点，不物化即被后续序列化还原）；
 *      [hidden] 属性摘除；var 驱动（display:var(--gone)）兜底内联覆写
 *      display:block。产物零隐藏声明，内容与自然样式流进步骤 7
 *   0. 字符串规范化（浏览器，lib/page-normalize-styles.js）：style 属性
 *      字符串 token 重引为单引号 + 内层引号转义——juice 写回会把值内 "
 *      无条件换成 '，引号混排形状（"D'Nealian"、'a"b'）会被改写成未闭合
 *      字符串、吞掉同属性后续声明；DOM 圈选只碰 style 属性
 *   0.5 @layer 解包（浏览器，lib/page-unwrap-layers.js）：Tailwind v4 把
 *      工具类规则包在 @layer utilities 里而 juice 不进层——层内规则原样
 *      提升到顶层，否则一条都内联不进去；与阶段 0 共用同一次页面加载
 *   1. juice（Node）：按自身 CSS 级联引擎把 <style> 规则内联到元素的
 *      style 属性并移除标签——字面声明值：不推导继承；var() 在变量已定义
 *      时解析为具体值（:root 变量定义随层解包提升后对 juice 可见——
 *      Tailwind v4 的 --radius-lg 等即此路径），未定义的保持字面；
 *      原有内联样式参与级联故保留；decodeStyleAttributes 在解析层对
 *      style 值做实体解码（&quot; 等引号实体原样进严格 postcss 会崩）
 *   1.5 函数值真实化：page-collect-fn-values.js 在 juice 产物上收集值仍
 *      含 var()/color-mix()/calc() 或空串（简写属性带 var 的 CSSOM 形态）
 *      的声明对，page-resolve-computed.js 在原始样式页（完整 CSS+class+
 *      @property，未动过的 4_styled_extract.html）取 getComputedStyle
 *      计算值——juice 多级 var 递归会弄丢 color-mix 颜色空间参数产出
 *      非法值（浏览器整条丢弃）、@property 变量与 calc 保持函数引用；
 *      finalize 阶段替换为真实值或删净，终态零函数间接引用。有残留才开
 *      第二页，非函数值站点零开销
 *   2. 浏览器收尾（lib/page-finalize-inline.js，签名收 computedMap）：
 *      - 白名单清理：只留明显结构化的样式——边框背景（border、
 *        outline、background、box-shadow）、flex 与 grid 布局（display、
 *        flex、grid、gap、对齐、order）、滚动裁剪（overflow、
 *        overflow-x/y）、transform——加 font-size/font-weight（步骤 7
 *        判标题层级的信号）；其余——盒模型几何（宽高、margin、padding、
 *        box-sizing）、定位、字体与文本类其余（font-
 *        family、行高、字距、color、text 等）、交互、动画、厂商前缀、
 *        自定义属性——全删；值为 inherit 的声明删除；清空后移除 style
 *        属性。只动确有删除的元素——全合规的保持 juice 字面输出（被清
 *        理元素的声明经 CSSOM 重序列化，颜色归一为 rgb() 形式，语义等价）
 *      - <style> 标签与 class 属性删净（正文含字面 class="..." 文本也
 *        不会误伤）
 *
 * 历史：getComputedStyle 计算版已按效果对比移除，只保留 juice 路径。
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","juiceStyles":"...","styledCount":N}  → 退出码 0
 *   {"status":"error","reason":"..."}                    → 1
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import juice from 'juice';
import { emit, emitError, usage, log, debug } from './lib/contract.mjs';
import { urlDir } from './lib/env.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { proxyLaunchOptions, newU2MContext } from './lib/browser.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[++i];
      if (val === undefined || val.startsWith('--')) { usage(`参数 --${key} 缺少值`); return null; }
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const url = args.url;
  if (!url) return usage('用法: compute_styles.mjs --url <url>');

  const dir = urlDir(url);
  const extractPath = path.join(dir, '4_styled_extract.html');

  if (!fs.existsSync(extractPath)) {
    return emitError(`找不到 ${extractPath}，请先运行步骤 4`);
  }

  let extractHtml = await fsPromises.readFile(extractPath, 'utf8');
  // 原始副本：函数值真实化时重开一页加载未动过的样式页取 getComputedStyle
  const pristineHtml = extractHtml;
  const pageFinalizeFn = await readSharedScript('page-finalize-inline.js');
  const normalizeFn = await readSharedScript('page-normalize-styles.js');
  const unwrapFn = await readSharedScript('page-unwrap-layers.js');
  const collectFn = await readSharedScript('page-collect-fn-values.js');
  const resolveFn = await readSharedScript('page-resolve-computed.js');
  const stripHiddenFn = await readSharedScript('page-strip-hidden.js');
  debug(`读入 ${extractPath}（${extractHtml.length} 字节）`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await newU2MContext(browser);
    // 只拦 http(s) 子资源：DOM 解析与计算值不需要图片/字体/背景图
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();

    // 阶段零：隐藏声明剥离（page-strip-hidden.js）——收起的元素展开为可见，
    // 只删 display:none / visibility:hidden 声明本身（规则其余声明保留，
    // 自然 display:flex 等结构信号完整），内容流进步骤 7。CSSOM 改写即时
    // 反映到 <style> 序列化文本，后续各阶段与 juice 看到的即剥除后的样式表
    await page.setContent(extractHtml, { waitUntil: 'domcontentloaded' });
    const stripStats = await page.evaluate(`(${stripHiddenFn})()`);
    debug(`隐藏声明剥离: 规则/内联删 ${stripStats.decl} · hidden 属性摘 ${stripStats.attrs} · var 兜底覆写 ${stripStats.fallback}`);

    // 阶段一：style 属性字符串 token 规范化（机制与动机见
    // page-normalize-styles.js 头注——juice 写回把值内 " 无条件换成 '，
    // 引号混排形状会损毁后续声明；DOM 圈选只碰 style 属性）。
    // 与后续阶段共用同一次页面加载：各 evaluate 先后就地改 DOM，只序列化一次
    await page.evaluate(`(${normalizeFn})()`);

    // 阶段二：解包 <style> 里的 @layer 级联层（Tailwind v4 把工具类规则包在
    // @layer utilities 里，juice 不进层——不解包则层内规则一条都内联不进去，
    // 见 page-unwrap-layers.js 头注）
    extractHtml = await page.evaluate(`(${unwrapFn})()`);
    debug(`字符串规范化 + @layer 解包后 ${extractHtml.length} 字节`);

    // 阶段二：juice 内联 <style> 规则并移除标签（class 稍后在浏览器删净）。
    // decodeStyleAttributes：juice 以 decodeEntities:false 载入文档（cheerio），
    // style 值里的 &quot; 等引号实体原样进入严格 postcss 解析会崩（公众号
    // 真实页面触发）；该选项在解析层对 style 属性值做实体解码
    const juicedHtml = juice(extractHtml, { removeStyleTags: true, decodeStyleAttributes: true });
    debug(`juice 内联后 ${juicedHtml.length} 字节`);

    // 阶段三：白名单清场（page-finalize-inline.js）。先在 juice 产物上收集
    // 值仍含 var()/color-mix()/calc() 的声明对，有残留才开第二页加载原始
    // 样式页（完整 CSS + class + @property——浏览器真实渲染上下文）取
    // getComputedStyle 计算值；finalize 内替换为真实值或删净，终态零函数
    // 间接引用（juice 对多级 var 链的解析会弄丢 color-mix 颜色空间参数
    // 产出非法值，浏览器整条丢弃）
    await page.setContent(juicedHtml, { waitUntil: 'domcontentloaded' });
    const fnPairs = await page.evaluate(`(${collectFn})()`);
    let computedMap = {};
    if (fnPairs.length > 0) {
      const styledPage = await context.newPage();
      try {
        await styledPage.setContent(pristineHtml, { waitUntil: 'domcontentloaded' });
        computedMap = await styledPage.evaluate(`(${resolveFn})(${JSON.stringify(fnPairs)})`);
        debug(`函数值真实化：${fnPairs.length} 组声明对已取计算值`);
      } finally {
        await styledPage.close();
      }
    }
    const final = await page.evaluate(`(${pageFinalizeFn})(${JSON.stringify(computedMap)})`);

    const juicePath = path.join(dir, '5_juice_styles.html');
    await fsPromises.writeFile(juicePath, final.html, 'utf8');
    log(`样式内联完成: ${juicePath} (${final.styledCount} 个元素带样式)`);

    // 先关浏览器再 emit
    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      juiceStyles: juicePath,
      styledCount: final.styledCount,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
