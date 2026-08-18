# script/pylib/placeholder.py —— 与 lib/placeholder.mjs 对应；分类/清理逻辑复用 script/lib/page-*.js
import base64
import json
import re
from pathlib import Path
from urllib.parse import unquote, urljoin

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"

EXT_BY_TYPE = {
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
    "image/svg+xml": "svg", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/avif": "avif",
}


def read_shared_script(name: str) -> str:
    return (LIB_DIR / name).read_text(encoding="utf-8")


def make_ctx(dirs: dict, context, log=print) -> dict:
    return {"dirs": dirs, "context": context, "log": log,
            "counters": {"img": 0, "complex": 0}, "entries": [], "warnings": []}


def write_manifest(manifest_path, entries) -> None:
    Path(manifest_path).write_text(
        json.dumps({"version": 1, "items": entries}, ensure_ascii=False, indent=2), encoding="utf-8")


def _call_on_element(handle, src: str):
    """T7 修正（镜像 Node callOnElement）：以 '(' + src + ')' 形式在元素上调用共享脚本函数。

    直接 `evaluate(f"({src})")` 会丢失元素实参（page-inline/page-latex 均接收 el），
    故经真实函数适配器 eval 后以元素为首参调用。
    """
    return handle.evaluate(
        "(el, s) => { const fn = eval('(' + s + ')'); return fn(el); }", src)


def process_mermaid(page, ctx) -> int:
    handles = page.query_selector_all("[data-u2m-mermaid-src]")
    for h in handles:
        src = h.get_attribute("data-u2m-mermaid-src") or ""
        if not src.strip():
            continue
        ctx["counters"]["complex"] += 1
        cid = f"COMPLEX_DIV_{ctx['counters']['complex']}"
        esc = src.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        _replace_with_html(page, h, f'<pre><code class="language-mermaid">{esc}</code></pre>')
        ctx["entries"].append({"id": cid, "type": "mermaid", "status": "done"})
        ctx["log"](f"mermaid 源码直出: {cid}")
    return len(handles)


def process_special_elements(page, ctx) -> int:
    classify = read_shared_script("page-classify.js")
    inline = read_shared_script("page-inline.js")
    latex = read_shared_script("page-latex.js")
    dirs = ctx["dirs"]
    processed = 0

    for _ in range(10):  # 合并循环上限
        page.evaluate(f"({classify})()")
        handles = page.query_selector_all("[data-u2m-type]")
        if not handles:
            break
        merged = False
        for h in handles:
            try:
                etype = h.get_attribute("data-u2m-type")
            except Exception:
                continue
            if etype == "same_origin_iframe":
                page.evaluate(
                    '(el) => { const host = document.createElement("div"); const doc = el.contentDocument;'
                    " if (doc && doc.body) { for (const n of Array.from(doc.body.childNodes)) host.appendChild(document.adoptNode(n)); }"
                    " el.replaceWith(host); }", h)
                merged = True  # 合并后新内容下一轮分类
                continue
            ctx["counters"]["complex"] += 1
            cid = f"COMPLEX_DIV_{ctx['counters']['complex']}"
            rel = lambda ext: f"assets/complex/{cid}.{ext}"  # noqa: E731
            try:
                if etype == "screenshot":
                    png = Path(dirs["wf"]) / rel("png")
                    tag = h.evaluate("el => el.tagName")
                    link = ""
                    if tag == "VIDEO":
                        vsrc = h.evaluate('(el) => el.getAttribute("src") || el.currentSrc || ""')
                        if vsrc:
                            link = f'<a href="{vsrc}">（视频源：{vsrc}）</a>'
                    h.screenshot(path=str(png))
                    # data-u2m-asset 标记：分派自产的资源引用，process_images 跳过
                    _replace_with_html(page, h, f'<img src="{rel("png")}" alt="{cid}" data-u2m-asset="1">{link}')
                    ctx["entries"].append({"id": cid, "type": etype, "final": rel("png"), "status": "done"})
                elif etype == "passthrough_svg":
                    svg = h.evaluate(
                        '(el) => { const c = el.cloneNode(true); c.querySelectorAll("script").forEach((s) => s.remove());'
                        ' [c, ...c.querySelectorAll("*")].forEach((n) => { for (const a of Array.from(n.attributes)) if (/^on/i.test(a.name)) n.removeAttribute(a.name); });'
                        ' c.setAttribute("xmlns", "http://www.w3.org/2000/svg"); return c.outerHTML; }')
                    (Path(dirs["wf"]) / rel("svg")).write_text(svg, encoding="utf-8")
                    _replace_with_html(page, h, f'<img src="{rel("svg")}" alt="{cid}" data-u2m-asset="1">')
                    ctx["entries"].append({"id": cid, "type": etype, "final": rel("svg"), "status": "done"})
                elif etype == "svg_convert":
                    draft = _call_on_element(h, inline)
                    (Path(dirs["draft"]) / f"{cid}.html").write_text(draft, encoding="utf-8")
                    _replace_with_text(page, h, "{{" + cid + "}}")
                    ctx["entries"].append({"id": cid, "type": etype, "draft": f"assets/draft/{cid}.html", "status": "pending"})
                elif etype == "latex":
                    tex = _call_on_element(h, latex)
                    if tex:
                        _replace_with_text(page, h, f"$${tex}$$")
                        ctx["entries"].append({"id": cid, "type": etype, "status": "done"})
                    else:
                        draft = h.evaluate("(el) => el.outerHTML")
                        (Path(dirs["draft"]) / f"{cid}.html").write_text(draft, encoding="utf-8")
                        _replace_with_text(page, h, "{{" + cid + "}}")
                        ctx["entries"].append({"id": cid, "type": etype, "draft": f"assets/draft/{cid}.html", "status": "pending"})
                processed += 1
            except Exception as e:  # noqa: BLE001
                ctx["warnings"].append(f"特殊元素处理失败({etype}): {e}")
                try:
                    h.evaluate('(el) => el.removeAttribute("data-u2m-type")')
                except Exception:
                    pass  # 已脱离 DOM
        if not merged:
            break
    return processed


def process_images(page, ctx) -> int:
    # 跳过分派自产的最终资源引用（data-u2m-asset），只处理正文图片（T7 修正，镜像 Node 选择器）
    jobs = []
    for h in page.query_selector_all("img:not([data-u2m-asset])"):
        try:
            src = h.get_attribute("src")
        except Exception:
            continue
        if src:
            ctx["counters"]["img"] += 1
            jobs.append((h, src, ctx["counters"]["img"]))

    # Node 版 4 路并发下载；Python sync Playwright 连接绑定创建线程（greenlet），
    # 跨线程调用 request/evaluate 直接崩溃（实测 greenlet.error: cannot switch to a different thread），
    # 故串行下载——语义（计数/落盘/替换/失败告警）与 Node 完全一致。
    ok = 0
    for h, src, n in jobs:
        try:
            if src.startswith("data:"):
                m = re.match(r"^data:([^;,]+)(;base64)?,(.*)$", src, re.S)
                if not m:
                    raise ValueError("无法解析 data URL")
                ctype = m.group(1)
                buf = base64.b64decode(m.group(3)) if m.group(2) else unquote(m.group(3)).encode("utf-8")
            else:
                # 相对 URL 需以当前页面 URL 解析为绝对地址（APIRequestContext 无 baseURL，T7 修正）
                res = ctx["context"].request.get(urljoin(page.url, src))
                if not res.ok:
                    raise ValueError(f"HTTP {res.status}")
                ctype = (res.headers.get("content-type") or "").split(";")[0]
                buf = res.body()
            ext = EXT_BY_TYPE.get(ctype, "png")
            (Path(ctx["dirs"]["images"]) / f"IMG_{n}.{ext}").write_bytes(buf)
            _replace_with_text(page, h, f"{{{{IMG_{n}}}}}")
            ok += 1
        except Exception as e:  # noqa: BLE001
            ctx["warnings"].append(f"图片下载失败保留原 URL: {src} ({e})")
    return ok


def _replace_with_text(page, handle, text):
    # 参数列表须解构（[el, text]）：page.evaluate 的 arg 单参传入，不解构则 el 拿到整个数组
    page.evaluate('([el, text]) => el.replaceWith(document.createTextNode(text))', [handle, text])


def _replace_with_html(page, handle, html):
    page.evaluate('([el, html]) => { const t = document.createElement("template"); t.innerHTML = html; el.replaceWith(...t.content.childNodes); }', [handle, html])
