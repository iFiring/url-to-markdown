#!/usr/bin/env python3
"""clear_trans_html.py <url> —— Python 工作流：完整性→特殊元素→清理→readability-lxml→markdownify→sketch.md"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from markdownify import MarkdownConverter  # noqa: E402
from readability import Document  # noqa: E402

from pylib import env, placeholder  # noqa: E402
from pylib.browser import open_page  # noqa: E402


def log_err(*a):
    print(*a, file=sys.stderr)


def emit(result: dict, code: int):
    print(json.dumps(result, ensure_ascii=False), flush=True)
    sys.exit(code)


def usage(msg: str):
    emit({"status": "usage_error", "reason": msg}, 2)


def progressive_scroll(page):
    page.evaluate("""async () => {
    let last = -1;
    for (let i = 0; i < 60; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 150));
      const h = document.documentElement.scrollHeight;
      if (h === last) break;
      last = h;
    }
    window.scrollTo(0, 0);
  }""")


def wait_for_dom_stable(page, stable_ms=1000, max_ms=15000):
    import time
    # Node 版用 Date.now()（毫秒）；time.time() 为秒，阈值须换算，否则稳定页要自旋 1000 秒
    stable_s, max_s = stable_ms / 1000, max_ms / 1000
    t0 = time.time()
    last, last_change = -1, time.time()
    while time.time() - t0 < max_s:
        n = page.evaluate("() => document.getElementsByTagName('*').length")
        if n != last:
            last, last_change = n, time.time()
        elif time.time() - last_change >= stable_s:
            return
        page.wait_for_timeout(200)


def code_language(tag):
    """markdownify 回调：从 <code class="language-x"> 补齐围栏语言标注（与 Node 工作流形态一致）。

    回调收到的是 <pre>（块级）本身，语言标注在其子 <code> 上，故两者都查。
    """
    for el in (tag, *tag.find_all("code")):
        for cls in el.get("class") or []:
            if cls.startswith("language-"):
                return cls[len("language-"):]
    return ""


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("--"):
        usage("用法: clear_trans_html.py <url>")
    url = sys.argv[1]
    dirs = env.ensure_workflow_dirs(url, "python_workflow")
    warnings = []

    page_init = placeholder.read_shared_script("page-init.js")
    page_merge = placeholder.read_shared_script("page-merge.js")
    page_clean = placeholder.read_shared_script("page-clean.js")

    session = open_page(url, viewport={"width": 1280, "height": 3000},
                        init_scripts=[page_init],
                        storage_state_path=env.storage_state_path(), log=log_err)
    try:
        page = session.page
        progressive_scroll(page)
        wait_for_dom_stable(page)

        ctx = placeholder.make_ctx(dirs, session.context, log_err)
        page.evaluate(f"({page_merge})()")
        placeholder.process_mermaid(page, ctx)
        placeholder.process_special_elements(page, ctx)
        placeholder.process_images(page, ctx)
        page.evaluate(f"({page_clean})()")

        # 不传 url：readability-lxml 仅在给定 url 时才 make_links_absolute，
        # 分派自产的 assets/ 相对引用须原样保留（Node 侧 Readability 的绝对化在 mjs 中另行还原）
        # min_text_length=10：默认 25 会把 sanitize 中 content_length<25 的 table/div
        # （表格、"graph TD" 级短代码块容器）当噪声剔除，@mozilla/readability 无此行为
        html = page.content()
        doc = Document(html, min_text_length=10)
        content = doc.summary(html_partial=True)
        if not content or len(content.strip()) < 20:
            warnings.append("readability-lxml 未能解析主体，回退 body 全文")
            content = page.evaluate("() => document.body.innerHTML")

        md = MarkdownConverter(heading_style="ATX", bullets="-",
                               code_language_callback=code_language).convert(content)
        # 不转义下划线（镜像 Node .replace(/\\_/g, '_')）：{{IMG_n}}/{{COMPLEX_DIV_n}}
        # 是后续精确替换的机器令牌，markdownify 默认转义 _ 须还原
        md = md.replace("\\_", "_").strip() + "\n"

        (dirs["wf"] / "sketch.md").write_text(md, encoding="utf-8")
        placeholder.write_manifest(dirs["manifest"], ctx["entries"])
        payload = {
            "status": "ok",
            "sketch": str(dirs["wf"] / "sketch.md"),
            "images": ctx["counters"]["img"],
            "complex": len(ctx["entries"]),
            "warnings": warnings + ctx["warnings"],
        }
    finally:
        try:
            session.close()  # 先关浏览器再输出退出（emit 内 sys.exit）；关闭失败不吞结果（镜像 Node .catch(() => {})）
        except Exception:  # noqa: BLE001
            pass
    emit(payload, 0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        emit({"status": "error", "reason": str(e)}, 1)
