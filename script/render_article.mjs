#!/usr/bin/env node
/**
 * render_article.mjs —— 步骤 4：文章视图渲染（原步骤 4/5/6 合并，2026-09-11）。
 * 读 2_clean_style_snapshot.html 与 3_key_ids.json（四键契约
 * titleId/descriptionIds/paragraphIds/dumpIds，校验与 paragraphIds 嵌套展开
 * 共享 lib/key-ids.mjs），单个 chromium 实例三轮处理一气呵成，产出文章视图
 * 4_article.html（写入该 URL 的工作目录）。超过
 * U2M_ARTICLE_SPLIT_THRESHOLD（默认 60KB）时另产出分块
 * 4_article_chunk_X_of_N.html（lib/chunk-article.mjs 纯函数分块，spec
 * 2026-09-09——第 2 块起带只读上下文；✅/❌ 转换边界标记每块恒在：首块 ✅
 * 紧跟 body 开标签、末块 ❌ 紧贴 </body>）。
 *
 * 用法:
 *   node render_article.mjs --url <url>
 *
 * 三轮处理（单浏览器贯穿；context 只拦 http(s) 子资源——DOM 解析与计算值
 * 不需要图片/字体/背景图，本 context 仅 DOM 计算，勿在此开 live 页）:
 *  A. 样式视图裁剪（lib/page-extract-styled.js）：
 *     - 完整保留（一字不动，含全部标签属性与样式属性）：titleId/
 *       descriptionIds/paragraphIds 所指标量块的子树 + 它们到 <body> 的
 *       祖先链——祖先上下文不变，CSS 选择器照常生效；paragraphIds 嵌套
 *       （数组 = 子段落流）在读取时展开为扁平块清单传给页面函数
 *     - dumpIds：段落流内噪音折叠为空元素——清空全部子节点，属性仅留
 *       id/class/data-idx；壳占住流内位置（轮 B juice 求值 nth-child/
 *       相邻选择器时兄弟结构不失真），轮 C 迁移块时壳不在清单、自然
 *       不入文章。落在保留区外的 dump 随所属分支删除
 *     - <head> 完全不动（<title> + 全部 <style> 原地保留）；body 里即将删除
 *       或折叠的分支中若有 <style>，先挪入 <head> 再处理，样式标签零丢失
 *     - 删除：其余全部 body 元素（页面 chrome、流外噪音）
 *  B. 样式内联 juice：
 *    -1. 隐藏声明剥离（lib/page-strip-hidden.js）：收起的元素展开为
 *        可见——CSSOM 删样式表规则与内联 style 的 display:none/
 *        visibility:hidden 声明（只删隐藏声明、规则其余声明保留——
 *        display:flex 等自然布局信号不被 block 盲改），规则集 cssText 写回
 *        <style> 文本；[hidden] 属性摘除；var 驱动（display:var(--gone)）
 *        兜底内联覆写 display:block。产物零隐藏声明
 *     0. 字符串规范化（lib/page-normalize-styles.js）：style 属性字符串
 *        token 重引为单引号 + 内层引号转义——juice 写回会把值内 " 无条件
 *        换成 '，引号混排形状（"D'Nealian"、'a"b'）会被改写成未闭合
 *        字符串、吞掉同属性后续声明
 *     0.5 @layer 解包（lib/page-unwrap-layers.js）：Tailwind v4 把工具类
 *        规则包在 @layer utilities 里而 juice 不进层——层内规则原样提升
 *        到顶层，否则一条都内联不进去；与阶段 0 共用同一次页面加载
 *     1. juice（Node）：按自身 CSS 级联引擎把 <style> 规则内联到元素的
 *        style 属性并移除标签——字面声明值：不推导继承；var() 在变量已
 *        定义时解析为具体值，未定义的保持字面；decodeStyleAttributes
 *        在解析层对 style 值做实体解码（&quot; 等引号实体原样进严格
 *        postcss 会崩）
 *     1.5 函数值真实化：page-collect-fn-values.js 在 juice 产物上收集值仍
 *        含 var()/color-mix()/calc() 或空串的声明对，
 *        page-resolve-computed.js 在原始样式页（完整 CSS+class+@property
 *        ——轮 A 输出的未动过副本 pristineHtml）取 getComputedStyle 计算
 *        值；finalize 阶段替换为真实值或删净，终态零函数间接引用。有残留
 *        才开第二页，非函数值站点零开销
 *     2. 浏览器收尾（lib/page-finalize-inline.js，签名收 computedMap）：
 *        白名单清理（只留边框背景/布局方向/transform + font-size/weight）、
 *        零值过滤、CSS 关键字零值、背景噪音两组、继承等值 font 修剪、
 *        <style> 标签与 class 属性删净——细则见该脚本头注
 *  C. 文章视图提取 + 瘦身 + 分块（lib/page-extract-article.js +
 *     page-slim-article.js）：
 *     - 块模型迁移：titleId/descriptionIds/paragraphIds 块全部按元素本身
 *       迁移（完整子树一字不动）；裸文本无 data-idx 不可标记、不迁——
 *       带裸文本的容器由步骤 3 整体标块兜底
 *     - 去重：同一元素被指名两次只出现一次；title/description 落在段落
 *       块子树内合法——最外层优先嵌套去重；排序按文档序
 *       （compareDocumentPosition）统一迁入
 *     - 瘦身 pass：迁移后同页 setContent 内存往返执行六条结构规则（见
 *       page-slim-article.js 头注）；保护集 = 迁入的 key 元素全集
 *     - 新 <body> 带阅读布局内联样式 max-width: 768px; margin: 4rem auto
 *
 * 产物:
 *   4_extract.html —— 轮 A 裁剪视图（调试中间产物，emit 不报）
 *   4_juice.html   —— 轮 B 纯内联视图（调试中间产物，emit 不报）
 *   4_article.html [+ 4_article_chunk_X_of_N.html] —— 终态文章视图
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","article":"...","elementCount":N,"removedCount":R,
 *    "keptCount":K,"dumpCollapsedCount":D,"styledCount":S,"slim":{...},
 *    "chunks":{"split":false,"count":1,"files":[...]}} → 退出码 0
 *   {"status":"error","reason":"..."} → 1（快照/key_ids 缺失、id 未命中、
 *                                       四键重叠、dump 是 key 祖先等）
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
import { parseKeyIds } from './lib/key-ids.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { proxyLaunchOptions, newU2MContext } from './lib/browser.mjs';
import { chunkArticle } from './lib/chunk-article.mjs';

// 大产物分块阈值默认值（字节单位，正整数 env 覆盖）：
// U2M_ARTICLE_SPLIT_THRESHOLD 触发分割、U2M_ARTICLE_CHUNK_MAX 每块主内容上限
const DEFAULT_SPLIT_THRESHOLD = 60 * 1024; // 60KB
const DEFAULT_CHUNK_MAX = 40 * 1024; // 40KB

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

// 正整数 env 覆盖（字节单位）；未设/非法取默认值
function posIntEnv(name, dflt) {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const url = args.url;
  if (!url) return usage('用法: render_article.mjs --url <url>');

  const dir = urlDir(url);
  const styledPath = path.join(dir, '2_clean_style_snapshot.html');
  const keyIdsPath = path.join(dir, '3_key_ids.json');

  if (!fs.existsSync(styledPath)) {
    return emitError(`找不到 ${styledPath}，请先运行步骤 2`);
  }
  if (!fs.existsSync(keyIdsPath)) {
    return emitError(`找不到 ${keyIdsPath}，请先运行步骤 3`);
  }

  const keyIds = JSON.parse(await fsPromises.readFile(keyIdsPath, 'utf8'));

  // 四键契约校验（开浏览器前拦截形状与自相矛盾输入）与 paragraphIds
  // 嵌套展开（数组 = 子段落流 → 扁平块清单）共享 lib/key-ids.mjs——
  // 本步骤与步骤 6 render_markdown 读同一文件、同一校验事实源
  const parsed = parseKeyIds(keyIds);
  if (parsed.error) return emitError(parsed.error);
  const { titleId, descriptionIds, blockIds, dumpIds } = parsed;
  debug(`key_ids: title=${titleId ?? '无'} desc=${descriptionIds.length} blocks=${blockIds.length} dump=${dumpIds.length}`);

  const pageExtractStyledFn = await readSharedScript('page-extract-styled.js');
  const stripHiddenFn = await readSharedScript('page-strip-hidden.js');
  const normalizeFn = await readSharedScript('page-normalize-styles.js');
  const unwrapFn = await readSharedScript('page-unwrap-layers.js');
  const collectFn = await readSharedScript('page-collect-fn-values.js');
  const resolveFn = await readSharedScript('page-resolve-computed.js');
  const pageFinalizeFn = await readSharedScript('page-finalize-inline.js');
  const pageExtractArticleFn = await readSharedScript('page-extract-article.js');
  const pageSlimFn = await readSharedScript('page-slim-article.js');
  const latexFn = await readSharedScript('page-latex.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await newU2MContext(browser);
    // 只拦 http(s) 子资源：DOM 解析与计算值不需要图片/字体/背景图
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();

    // ── 轮 A · 样式视图裁剪（原步骤 4）──
    await page.goto(`file://${styledPath}`, { waitUntil: 'domcontentloaded' });

    const extract = await page.evaluate(
      `(${pageExtractStyledFn})(${JSON.stringify({ titleId, descriptionIds, blockIds, dumpIds })})`
    );

    if (extract.missing) {
      // 先关浏览器再 emit（emit 会退出进程）
      await context.close();
      await browser.close();
      browser = null;
      return emitError(
        `key id 在带样式快照中未命中: ${extract.missing.join(', ')}（key_ids 与快照不匹配，请重跑步骤 3）`,
        1
      );
    }
    if (extract.conflict) {
      await context.close();
      await browser.close();
      browser = null;
      return emitError(
        `dumpIds 与 key 元素冲突: dump ${extract.conflict.dump} 是 key ${extract.conflict.key} 的祖先（折叠会摧毁 key 子树），请重跑步骤 3`,
        1
      );
    }

    const extractPath = path.join(dir, '4_extract.html');
    await fsPromises.writeFile(extractPath, extract.html, 'utf8');
    log(`样式视图裁剪完成: ${extractPath} (删除 ${extract.removed} 个元素, 折叠噪音 ${extract.dumpCollapsed} 个)`);

    // 原始副本：轮 B 函数值真实化时重开一页加载未动过的样式页取
    // getComputedStyle（完整 CSS+class+@property）——后续任何阶段不得覆写
    const pristineHtml = extract.html;

    // ── 轮 B · 样式内联（原步骤 5，输入为轮 A 内存串）──
    // 隐藏声明剥离：收起的元素展开为可见，只删 display:none /
    // visibility:hidden 声明本身（规则其余声明保留，自然 display:flex 等
    // 结构信号完整）。CSSOM 改写即时反映到 <style> 序列化文本，后续各
    // 阶段与 juice 看到的即剥除后的样式表
    await page.setContent(pristineHtml, { waitUntil: 'domcontentloaded' });
    const stripStats = await page.evaluate(`(${stripHiddenFn})()`);
    debug(`隐藏声明剥离: 规则/内联删 ${stripStats.decl} · hidden 属性摘 ${stripStats.attrs} · var 兜底覆写 ${stripStats.fallback}`);

    // style 属性字符串 token 规范化（juice 写回把值内 " 无条件换成 '，
    // 引号混排形状会损毁后续声明）；与 @layer 解包共用同一次页面加载
    await page.evaluate(`(${normalizeFn})()`);

    // 解包 <style> 里的 @layer 级联层（Tailwind v4 把工具类规则包在
    // @layer utilities 里，juice 不进层——不解包则层内规则零内联）
    const stagedHtml = await page.evaluate(`(${unwrapFn})()`);
    debug(`字符串规范化 + @layer 解包后 ${stagedHtml.length} 字节`);

    // juice 内联 <style> 规则并移除标签（class 稍后在浏览器删净）。
    // decodeStyleAttributes：style 值里的 &quot; 等引号实体原样进入严格
    // postcss 解析会崩（公众号真实页面触发），该选项在解析层做实体解码
    const juicedHtml = juice(stagedHtml, { removeStyleTags: true, decodeStyleAttributes: true });
    debug(`juice 内联后 ${juicedHtml.length} 字节`);

    // 函数值真实化：先在 juice 产物上收集值仍含 var()/color-mix()/calc()
    // 的声明对，有残留才开第二页加载原始样式页取 getComputedStyle 计算值
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

    const juicePath = path.join(dir, '4_juice.html');
    await fsPromises.writeFile(juicePath, final.html, 'utf8');
    log(`样式内联完成: ${juicePath} (${final.styledCount} 个元素带样式)`);

    // ── 轮 C · 文章视图提取 + 瘦身 + 分块（原步骤 6）──
    await page.setContent(final.html, { waitUntil: 'domcontentloaded' });

    const migrated = await page.evaluate(
      `(${pageExtractArticleFn})(${JSON.stringify({ titleId, descriptionIds, blockIds })})`
    );

    if (migrated.missing) {
      // 防御分支：轮 A 已在同一批 id 上校验过命中，内联后丢失属管线
      // 内部错误，不指路步骤 3
      await context.close();
      await browser.close();
      browser = null;
      return emitError(
        `key id 在纯内联视图中未命中: ${migrated.missing.join(', ')}（内部错误：轮 A 已命中、内联后丢失，请重跑本步骤；复现请反馈）`,
        1
      );
    }

    // 瘦身 pass：迁移后的文章视图在内存中重载（同页 setContent，不落盘），
    // 六条结构规则见 page-slim-article.js 头注。保护集 = 迁入的 key
    // 元素全集（titleId∪descriptionIds∪块）
    await page.setContent(migrated.html, { waitUntil: 'domcontentloaded' });
    const protectedIds = [];
    if (titleId !== null) protectedIds.push(titleId);
    protectedIds.push(...descriptionIds, ...blockIds);
    // page-latex.js 的 __u2mLatexText 以函数声明进入同一作用域，
    // page-slim-article.js 规则② 闭包内可见
    const { html: slimHtml, ...slimStats } = await page.evaluate(
      `(function(){ ${latexFn} return (${pageSlimFn})(${JSON.stringify(protectedIds)}); })()`
    );

    // 分块收集：与 slimHtml 同一 DOM 同一序列化器——每块 markup 与
    // 4_article.html 逐字节一致（spec 2026-09-09 §3.2）
    const children = await page.evaluate(
      '(() => [...document.body.children].map((el) => el.outerHTML))()'
    );

    // 先关浏览器再 emit
    await context.close();
    await browser.close();
    browser = null;

    const articlePath = path.join(dir, '4_article.html');
    await fsPromises.writeFile(articlePath, slimHtml, 'utf8');
    log(`文章视图提取完成: ${articlePath} (${migrated.count} 个元素, 瘦身 ${JSON.stringify(slimStats)})`);

    // ── stale 清理（spec §3.6）：重跑本步骤后任何已存在的步骤 5 骨架必然
    //    失效；另一模式的旧分块 html 一并清理 ──
    for (const f of fs.readdirSync(dir)) {
      if (f === '5_skeleton.json' || /^5_skeleton_chunk_\d+_of_\d+\.json$/.test(f)) {
        fs.rmSync(path.join(dir, f));
      }
    }
    const splitThreshold = posIntEnv('U2M_ARTICLE_SPLIT_THRESHOLD', DEFAULT_SPLIT_THRESHOLD);
    const chunkMax = posIntEnv('U2M_ARTICLE_CHUNK_MAX', DEFAULT_CHUNK_MAX);
    const { split, chunks: chunkFiles } = chunkArticle(slimHtml, children, { splitThreshold, chunkMax });
    const CHUNK_HTML_RE = /^4_article_chunk_(\d+)_of_(\d+)\.html$/;
    for (const f of fs.readdirSync(dir)) {
      const cm = CHUNK_HTML_RE.exec(f);
      if (cm && (!split || Number(cm[1]) > chunkFiles.length)) fs.rmSync(path.join(dir, f));
    }
    const chunkPaths = [];
    if (split) {
      for (const c of chunkFiles) {
        const p = path.join(dir, `4_article_chunk_${c.x}_of_${c.n}.html`);
        await fsPromises.writeFile(p, c.html, 'utf8');
        chunkPaths.push(p);
      }
      log(`文章分块: ${chunkPaths.length} 块（阈值 ${splitThreshold}B / 上限 ${chunkMax}B）`);
    }

    emit({
      status: 'ok',
      article: articlePath,
      elementCount: migrated.count,
      removedCount: extract.removed,
      keptCount: extract.kept,
      dumpCollapsedCount: extract.dumpCollapsed,
      styledCount: final.styledCount,
      slim: slimStats,
      chunks: split
        ? { split: true, count: chunkPaths.length, files: chunkPaths }
        : { split: false, count: 1, files: [articlePath] },
    });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
