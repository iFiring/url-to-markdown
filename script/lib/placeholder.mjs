// script/lib/placeholder.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const libDir = path.dirname(fileURLToPath(import.meta.url));

export async function readSharedScript(name) {
  return fs.readFile(path.join(libDir, name), 'utf8');
}

const EXT_BY_TYPE = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/avif': 'avif',
};

export function makeCtx(dirs, { context, log = () => {} } = {}) {
  return { dirs, context, log, counters: { img: 0, complex: 0 }, entries: [], warnings: [] };
}

export async function writeManifest(manifestPath, entries) {
  await fs.writeFile(manifestPath, JSON.stringify({ version: 1, items: entries }, null, 2));
}

/**
 * 以 '(' + src + ')' 形式在元素上调用共享脚本函数（page-*.js 的具名声明）。
 * Playwright 1.62 的 evaluate 字符串参数只按表达式求值、不会自动作为函数调用，
 * 故经真实函数适配器 eval 后以元素为首参调用。
 */
const callOnElement = (handle, src) =>
  handle.evaluate((el, s) => { const fn = eval('(' + s + ')'); return fn(el); }, src);

/** DOM 元素替换为文本节点（占位符 / $$..$$） */
function replaceWithText(frame, handle, text) {
  return frame.evaluate(([el, t]) => el.replaceWith(document.createTextNode(t)), [handle, text]);
}

/** DOM 元素替换为 HTML 片段（最终图片引用等） */
function replaceWithHtml(frame, handle, html) {
  return frame.evaluate(([el, h]) => {
    const t = document.createElement('template');
    t.innerHTML = h;
    el.replaceWith(...t.content.childNodes);
  }, [handle, html]);
}

/** Mermaid：钩子取到源码的容器 → <pre><code class="language-mermaid">；登记 done。 */
export async function processMermaid(frame, ctx) {
  const handles = await frame.$$('[data-u2m-mermaid-src]');
  for (const h of handles) {
    const src = await h.getAttribute('data-u2m-mermaid-src');
    if (!src || !src.trim()) continue;
    const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
    const esc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await replaceWithHtml(frame, h, `<pre><code class="language-mermaid">${esc}</code></pre>`);
    ctx.entries.push({ id, type: 'mermaid', status: 'done' });
    ctx.log(`mermaid 源码直出: ${id}`);
  }
  return handles.length;
}

const PLAN_ACTIONS = new Set(['keep', 'delete', 'code_block', 'screenshot', 'passthrough_svg', 'svg_convert', 'latex', 'block_screenshot']);

export function validateClassifyPlan(plan) {
  if (!plan || plan.version !== 2) throw new Error('plan.version 必须为 2');
  if (typeof plan.listFlowSelector !== 'string' || !plan.listFlowSelector.trim()) throw new Error('plan.listFlowSelector 缺失');
  if (!Array.isArray(plan.blocks)) throw new Error('plan.blocks 缺失');
  for (const b of plan.blocks) {
    if (!Number.isInteger(b.id)) throw new Error(`block.id 非法: ${JSON.stringify(b)}`);
    if (!PLAN_ACTIONS.has(b.action)) throw new Error(`block.action 非法: ${b.action}`);
    if (b.blockOf != null && !Number.isInteger(b.blockOf)) throw new Error(`block.blockOf 非法: ${JSON.stringify(b)}`);
  }
}

/**
 * 按 v2 plan 分派：删列表流子树外兄弟 → 逐块按 action 处理。
 * 分支语义（screenshot 的 VIDEO 源链接、
 * passthrough_svg 的消毒、svg_convert/latex 的 draft+占位符均保持一致）。
 */
export async function applyClassifyPlan(frame, ctx, plan) {
  validateClassifyPlan(plan);
  const listFlow = await frame.$(plan.listFlowSelector);
  if (!listFlow) throw new Error(`listFlowSelector 未命中: ${plan.listFlowSelector}`);
  // 1. 删列表流子树外的兄弟节点（结构去噪；listFlow 子树内部交给逐块 action）
  await frame.evaluate((sel) => {
    const lf = document.querySelector(sel);
    if (!lf || !lf.parentElement) return;
    for (const sib of Array.from(lf.parentElement.children)) if (sib !== lf) sib.remove();
  }, plan.listFlowSelector);

  const inline = await readSharedScript('page-inline.js');
  const latex = await readSharedScript('page-latex.js');
  let processed = 0;
  for (const b of plan.blocks) {
    const h = await frame.$(`[data-u2m-id="${b.id}"]`);
    if (!h) { ctx.warnings.push(`plan id 未命中（快照中不存在或已被外层删除）: ${b.id}`); continue; }
    try {
      if (b.action === 'keep') {
        // 不动
      } else if (b.action === 'delete') {
        await h.evaluate((el) => el.remove());
      } else if (b.action === 'code_block') {
        const text = await h.evaluate((el) => el.textContent);
        let lang = await h.evaluate((el) => {
          const fromAttr = el.getAttribute('data-lang');
          if (fromAttr && fromAttr.trim()) return fromAttr.trim();
          const m = String(el.className || '').match(/(?:language-|lang-)([\w+#-]+)/);
          if (m) return m[1];
          const inner = el.querySelector('[class*="language-"]');
          const m2 = inner && String(inner.className || '').match(/language-([\w+#-]+)/);
          return m2 ? m2[1] : '';
        });
        if (!lang) lang = guessCodeLang(text);
        await replaceWithHtml(frame, h, `<pre data-u2m-code><code class="language-${lang}">${escapeHtml(text)}</code></pre>`);
        // 代码是文本而非复杂资源：不进 manifest、不经步骤 3
      } else if (b.action === 'block_screenshot') {
        const target = await frame.$(`[data-u2m-id="${b.blockOf ?? b.id}"]`);
        if (!target) { ctx.warnings.push(`blockOf 未命中: ${b.blockOf ?? b.id}`); continue; }
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const rel = `assets/complex/${id}.png`;
        await target.screenshot({ path: path.join(ctx.dirs.wf, rel) });
        await replaceWithHtml(frame, target, `<img src="${rel}" alt="${id}" data-u2m-asset="1">`);
        ctx.entries.push({ id, type: 'block_screenshot', final: rel, status: 'done' });
      } else if (b.action === 'screenshot') {
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const rel = `assets/complex/${id}.png`;
        const tag = await h.evaluate((el) => el.tagName);
        let linkHtml = '';
        if (tag === 'VIDEO') {
          const src = await h.evaluate((el) => el.getAttribute('src') || el.currentSrc || '');
          if (src) linkHtml = `<a href="${src}">（视频源：${src}）</a>`;
        }
        await h.screenshot({ path: path.join(ctx.dirs.wf, rel) });
        // data-u2m-asset 标记：分派自产的资源引用，processImages 跳过
        await replaceWithHtml(frame, h, `<img src="${rel}" alt="${id}" data-u2m-asset="1">${linkHtml}`);
        ctx.entries.push({ id, type: 'screenshot', final: rel, status: 'done' });
      } else if (b.action === 'passthrough_svg') {
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const rel = `assets/complex/${id}.svg`;
        const svg = await h.evaluate((el) => {
          const c = el.cloneNode(true);
          c.querySelectorAll('script').forEach((s) => s.remove());
          [c, ...c.querySelectorAll('*')].forEach((n) => {
            for (const a of Array.from(n.attributes)) if (/^on/i.test(a.name)) n.removeAttribute(a.name);
          });
          c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          return c.outerHTML;
        });
        await fs.writeFile(path.join(ctx.dirs.wf, rel), svg, 'utf8');
        await replaceWithHtml(frame, h, `<img src="${rel}" alt="${id}" data-u2m-asset="1">`);
        ctx.entries.push({ id, type: 'passthrough_svg', final: rel, status: 'done' });
      } else if (b.action === 'svg_convert') {
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const draftHtml = await callOnElement(h, inline);
        await fs.writeFile(path.join(ctx.dirs.draft, `${id}.html`), draftHtml, 'utf8');
        // <p> 包裹：裸文本节点占位符会被 Readability 当噪声丢弃（冒烟发现）
        await replaceWithHtml(frame, h, `<p>{{${id}}}</p>`);
        ctx.entries.push({ id, type: 'svg_convert', draft: `assets/draft/${id}.html`, status: 'pending' });
      } else if (b.action === 'latex') {
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const tex = await callOnElement(h, latex);
        if (tex) {
          await replaceWithText(frame, h, `$$${tex}$$`);
          ctx.entries.push({ id, type: 'latex', status: 'done' });
        } else {
          const draftHtml = await h.evaluate((el) => el.outerHTML);
          await fs.writeFile(path.join(ctx.dirs.draft, `${id}.html`), draftHtml, 'utf8');
          // <p> 包裹：同上
          await replaceWithHtml(frame, h, `<p>{{${id}}}</p>`);
          ctx.entries.push({ id, type: 'latex', draft: `assets/draft/${id}.html`, status: 'pending' });
        }
      }
      processed++;
    } catch (e) {
      ctx.warnings.push(`action ${b.action}(id=${b.id}) 失败: ${e.message}`);
      try { await h.evaluate((el) => el.removeAttribute('data-u2m-id')); } catch { /* 已脱离 DOM */ }
    }
  }
  return processed;
}

/** 本地代码语言启发式（data-lang/class 缺失时的兜底）。返回 '' 表示无法判定。 */
export function guessCodeLang(text) {
  const t = String(text || '');
  const s = t.trim();
  const shebang = s.match(/^#!\s*(?:\S+\/)?(?:env\s+)?(bash|sh|zsh|python\d?|node)\b/);
  if (shebang) {
    const b = shebang[1];
    if (b.startsWith('python')) return 'python';
    if (b === 'node') return 'javascript';
    if (b === 'sh' || b === 'zsh') return 'bash';
    return b;
  }
  if ((s[0] === '{' && s.endsWith('}')) || (s[0] === '[' && s.endsWith(']'))) {
    try { JSON.parse(s); return 'json'; } catch { /* 非 JSON，继续判定 */ }
  }
  if (/\bdef\s+\w+\s*\([^)]*\)\s*:/.test(t)) return 'python';
  if (/\bconsole\.\w+\(|\bfunction\s+\w+\s*\(|\b(const|let|var)\s+\w+\s*=/.test(t)) return 'javascript';
  if (/^\s*<(html|body|div|span|head|p)\b/i.test(s)) return 'html';
  return '';
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 正文图片：并发（4）下载 → assets/images/IMG_n.<ext>；DOM 替换为 {{IMG_n}}；失败保留原样并告警。 */
export async function processImages(frame, ctx) {
  // 跳过分派自产的最终资源引用（data-u2m-asset），只处理正文图片
  const handles = await frame.$$('img:not([data-u2m-asset])');
  const jobs = [];
  for (const h of handles) {
    let src = null;
    try { src = await h.getAttribute('src'); } catch { continue; }
    if (!src) continue;
    const n = ++ctx.counters.img;
    jobs.push({ h, src, n });
  }
  let ok = 0;
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length) {
      const { h, src, n } = queue.shift();
      try {
        let buf, ctype;
        if (src.startsWith('data:')) {
          const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
          if (!m) throw new Error('无法解析 data URL');
          ctype = m[1];
          buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
        } else {
          // 相对 URL 需以当前 frame URL 解析为绝对地址（APIRequestContext 无 baseURL）
          let url = src;
          try { url = new URL(src, frame.url()).href; } catch { /* 保持原样，交给下载失败告警 */ }
          const res = await ctx.context.request.get(url);
          if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
          ctype = res.headers()['content-type']?.split(';')[0] || '';
          buf = await res.body();
        }
        const ext = EXT_BY_TYPE[ctype] || 'png';
        await fs.writeFile(path.join(ctx.dirs.images, `IMG_${n}.${ext}`), buf);
        await replaceWithText(frame, h, `{{IMG_${n}}}`);
        ok++;
      } catch (e) {
        ctx.warnings.push(`图片下载失败保留原 URL: ${src} (${e.message})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
  return ok;
}
