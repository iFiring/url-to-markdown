import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "script"))  # 使测试可 import pylib


class _FixtureHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(REPO / "test" / "fixtures"), **kw)

    def log_message(self, *a):  # 静音
        pass


def pytest_configure(config):
    config.addinivalue_line("markers", "integration: 需要浏览器/夹具服务的集成测试")


@pytest.fixture()
def fixture_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _FixtureHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


@pytest.fixture()
def tmp_working(tmp_path, monkeypatch):
    monkeypatch.setenv("U2M_WORKING_ROOT", str(tmp_path))
    return tmp_path
