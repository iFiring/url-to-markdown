# test/integration/test_browser.py
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from pylib import browser

pytestmark = pytest.mark.integration


def _start_dummy_proxy():
    """哑代理：记录收到的请求行（absolute-form URI），返回固定页。与 Node 侧 browser.test.mjs 对齐。"""
    hits = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            hits.append(self.path)
            body = "<!doctype html><title>via proxy</title><h1>via proxy</h1>".encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):  # 静音
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, hits


def test_open_page_loads_fixture(fixture_server):
    session = browser.open_page(f"{fixture_server}/static-article.html",
                                viewport={"width": 1280, "height": 800})
    try:
        session.page.locator("h1").wait_for(state="visible", timeout=5000)
        assert session.page.title() == "示例文章"
    finally:
        session.close()


def test_open_page_via_u2m_proxy(fixture_server, monkeypatch):
    server, hits = _start_dummy_proxy()
    try:
        monkeypatch.setenv("U2M_PROXY", f"http://127.0.0.1:{server.server_address[1]}")
        session = browser.open_page(f"{fixture_server}/static-article.html",
                                    viewport={"width": 1280, "height": 800})
        try:
            session.page.locator("h1").wait_for(state="visible", timeout=5000)
            assert session.page.title() == "via proxy"
            assert hits, "代理应收到请求"
            assert all(h.startswith("http://") for h in hits), "应为 absolute-form URI"
        finally:
            session.close()
    finally:
        server.shutdown()


def test_open_page_u2m_proxy_direct(fixture_server, monkeypatch):
    monkeypatch.setenv("U2M_PROXY", "direct")
    session = browser.open_page(f"{fixture_server}/static-article.html",
                                viewport={"width": 1280, "height": 800})
    try:
        session.page.locator("h1").wait_for(state="visible", timeout=5000)
        assert session.page.title() == "示例文章"
    finally:
        session.close()
