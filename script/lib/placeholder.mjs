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

/** 特殊元素分派主流程。返回处理数量。 */
export async function processSpecialElements(frame, ctx) {
  const classify = await readSharedScript('page-classify.js');
  const inline = await readSharedScript('page-inline.js');
  const latex = await readSharedScript('page-latex.js');
  let processed = 0;

  const classifyOnce = () => frame.evaluate(`(${classify})()`);
  const hoistIframe = (h) => h.evaluate((el) => {
    const host = document.createElement('div');
    const doc = el.contentDocument;
    if (doc && doc.body) { for (const n of Array.from(doc.body.childNodes)) host.appendChild(document.adoptNode(n)); }
    el.replaceWith(host);
  });

  for (;;) {
    await classifyOnce();
    const handles = await frame.$$('[data-u2m-type]');
    if (!handles.length) break;
    let merged = false;
    for (const h of handles) {
      let type;
      try { type = await h.getAttribute('data-u2m-type'); } catch { continue; }
      try {
        if (type === 'same_origin_iframe') {
          await hoistIframe(h); // 合并后新内容下一轮分类
          merged = true;
          continue;
        }
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const rel = (ext) => `assets/complex/${id}.${ext}`;
        if (type === 'screenshot') {
          const abs = path.join(ctx.dirs.wf, rel('png'));
          const tag = await h.evaluate((el) => el.tagName);
          let linkHtml = '';
          if (tag === 'VIDEO') {
            const src = await h.evaluate((el) => el.getAttribute('src') || el.currentSrc || '');
            if (src) linkHtml = `<a href="${src}">（视频源：${src}）</a>`;
          }
          await h.screenshot({ path: abs });
          // data-u2m-asset 标记：分派自产的资源引用，processImages 跳过
          await replaceWithHtml(frame, h, `<img src="${rel('png')}" alt="${id}" data-u2m-asset="1">${linkHtml}`);
          ctx.entries.push({ id, type, final: rel('png'), status: 'done' });
        } else if (type === 'passthrough_svg') {
          const abs = path.join(ctx.dirs.wf, rel('svg'));
          const svg = await h.evaluate((el) => {
            const c = el.cloneNode(true);
            c.querySelectorAll('script').forEach((s) => s.remove());
            [c, ...c.querySelectorAll('*')].forEach((n) => {
              for (const a of Array.from(n.attributes)) if (/^on/i.test(a.name)) n.removeAttribute(a.name);
            });
            c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            return c.outerHTML;
          });
          await fs.writeFile(abs, svg, 'utf8');
          await replaceWithHtml(frame, h, `<img src="${rel('svg')}" alt="${id}" data-u2m-asset="1">`);
          ctx.entries.push({ id, type, final: rel('svg'), status: 'done' });
        } else if (type === 'svg_convert') {
          const abs = path.join(ctx.dirs.draft, `${id}.html`);
          const draftHtml = await callOnElement(h, inline);
          await fs.writeFile(abs, draftHtml, 'utf8');
          await replaceWithText(frame, h, `{{${id}}}`);
          ctx.entries.push({ id, type, draft: `assets/draft/${id}.html`, status: 'pending' });
        } else if (type === 'latex') {
          const tex = await callOnElement(h, latex);
          if (tex) {
            await replaceWithText(frame, h, `$$${tex}$$`);
            ctx.entries.push({ id, type, status: 'done' });
          } else {
            const abs = path.join(ctx.dirs.draft, `${id}.html`);
            const draftHtml = await h.evaluate((el) => el.outerHTML);
            await fs.writeFile(abs, draftHtml, 'utf8');
            await replaceWithText(frame, h, `{{${id}}}`);
            ctx.entries.push({ id, type, draft: `assets/draft/${id}.html`, status: 'pending' });
          }
        }
        processed++;
      } catch (e) {
        ctx.warnings.push(`特殊元素处理失败(${type}): ${e.message}`);
        try { await h.evaluate((el) => el.removeAttribute('data-u2m-type')); } catch { /* 已脱离 DOM */ }
      }
    }
    if (!merged) break;
  }
  return processed;
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
