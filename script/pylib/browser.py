# script/pylib/browser.py
"""与 lib/browser.mjs 对应：storageState 纯函数 + open_page 会话。"""
import json
import shutil
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

EMPTY_STATE = {"cookies": [], "origins": []}


def prune_expired(state: dict, now_ms: int | None = None) -> dict:
    now_sec = int((now_ms if now_ms is not None else time.time() * 1000) // 1000)
    cookies = [c for c in state.get("cookies", [])
               if not (isinstance(c.get("expires"), (int, float)) and c["expires"] > 0 and c["expires"] < now_sec)]
    return {**state, "cookies": cookies}


def merge_storage_state(base: dict | None = None, incoming: dict | None = None) -> dict:
    base = base or EMPTY_STATE
    incoming = incoming or EMPTY_STATE
    cookie_map = {}
    for c in [*base.get("cookies", []), *incoming.get("cookies", [])]:
        cookie_map[(c["name"], c["domain"], c["path"])] = c
    origin_map: dict[str, dict] = {}
    for o in [*base.get("origins", []), *incoming.get("origins", [])]:
        ls = origin_map.setdefault(o["origin"], {})
        for entry in o.get("localStorage", []):
            ls[entry["name"]] = entry
    return {
        "cookies": list(cookie_map.values()),
        "origins": [{"origin": k, "localStorage": list(v.values())} for k, v in origin_map.items()],
    }


def read_storage_state(file_path: Path) -> dict:
    try:
        return prune_expired(json.loads(Path(file_path).read_text(encoding="utf-8")))
    except Exception:
        return {"cookies": [], "origins": []}


def write_storage_state(file_path: Path, state: dict) -> None:
    p = Path(file_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def goto_with_retry(page, url: str, log=print) -> None:
    last = None
    for attempt in (1, 2):
        try:
            page.goto(url, wait_until="networkidle", timeout=30000)
            return
        except Exception as e:  # noqa: BLE001
            last = e
            log(f"goto 失败({attempt}/2): {e}")
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(5000)


class PageSession:
    def __init__(self, pw, browser, context, page):
        self.pw, self.browser, self.context, self.page = pw, browser, context, page

    def close(self):
        try:
            self.context.close()
        finally:
            self.browser.close()
            self.pw.stop()


def open_page(url, *, headless=True, viewport=None, init_scripts=(), storage_state_path=None, log=print) -> PageSession:
    viewport = viewport or {"width": 1280, "height": 3000}
    pw = sync_playwright().start()
    browser = None  # launch 本身抛错时 except 分支才不会 UnboundLocalError 掩盖真实错误
    try:
        browser = pw.chromium.launch(headless=headless)
        ctx_kwargs = dict(viewport=viewport, bypass_csp=True)  # 与 lib/browser.mjs 对齐：绕过页面 CSP（eval/addScriptTag 注入）
        if storage_state_path and Path(storage_state_path).exists():
            ctx_kwargs["storage_state"] = str(storage_state_path)
        context = browser.new_context(**ctx_kwargs)
        context.route("**/*", lambda route: route.abort() if route.request.resource_type == "media" else route.continue_())
        for script in init_scripts:
            context.add_init_script(script=script)
        page = context.new_page()
        goto_with_retry(page, url, log)
        return PageSession(pw, browser, context, page)
    except Exception:
        try:
            if browser:
                browser.close()
        finally:
            pw.stop()
        raise
