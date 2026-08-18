# test/integration/test_clear_py.py
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from pylib.env import url_to_dir_name

REPO = Path(__file__).resolve().parent.parent.parent
SCRIPT = REPO / "script" / "clear_trans_html.py"

pytestmark = pytest.mark.integration


def run(tmp_working, url):
    # 继承完整环境（playwright 需要 HOME 等定位浏览器缓存），仅覆盖 working 根
    env = {**os.environ, "U2M_WORKING_ROOT": str(tmp_working)}
    return subprocess.run(
        [sys.executable, str(SCRIPT), url],
        capture_output=True, text=True, timeout=120, env=env,
    )


def wf(tmp_working, url, name="python_workflow"):
    return tmp_working / url_to_dir_name(url) / name


def test_static_article(fixture_server, tmp_working):
    r = run(tmp_working, f"{fixture_server}/static-article.html")
    assert r.returncode == 0, r.stderr
    payload = json.loads(r.stdout.strip())
    assert payload["status"] == "ok"
    assert payload["images"] == 1
    md = (wf(tmp_working, f"{fixture_server}/static-article.html") / "sketch.md").read_text(encoding="utf-8")
    assert "{{IMG_1}}" in md
    assert "PARA_ONE" in md
    assert "```js" in md
    assert "|名称|值|" in md.replace(" ", "")


def test_complex_elements(fixture_server, tmp_working):
    r = run(tmp_working, f"{fixture_server}/complex-elements.html")
    assert r.returncode == 0, r.stderr
    md = (wf(tmp_working, f"{fixture_server}/complex-elements.html") / "sketch.md").read_text(encoding="utf-8")
    assert "$$E=mc^2$$" in md
    assert "{{IMG_1}}" in md
    assert "assets/complex/" in md  # passthrough_svg 直替
    manifest = json.loads((wf(tmp_working, f"{fixture_server}/complex-elements.html") / "assets" / "manifest.json").read_text(encoding="utf-8"))
    types = sorted(i["type"] for i in manifest["items"])
    assert types == ["latex", "passthrough_svg", "screenshot", "screenshot", "svg_convert", "svg_convert"]


def test_code_block(fixture_server, tmp_working):
    r = run(tmp_working, f"{fixture_server}/code-block.html")
    assert r.returncode == 0, r.stderr
    md = (wf(tmp_working, f"{fixture_server}/code-block.html") / "sketch.md").read_text(encoding="utf-8")
    assert "```python" in md          # code_language 回调补齐围栏语言
    assert "复制" not in md
    assert "line-numbers-rows" not in md


def test_mermaid(fixture_server, tmp_working):
    r = run(tmp_working, f"{fixture_server}/mermaid.html")
    assert r.returncode == 0, r.stderr
    md = (wf(tmp_working, f"{fixture_server}/mermaid.html") / "sketch.md").read_text(encoding="utf-8")
    assert "```mermaid" in md


def test_usage_error(tmp_working):
    r = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True, timeout=30,
                       env={**os.environ, "U2M_WORKING_ROOT": str(tmp_working)})
    assert r.returncode == 2
    assert json.loads(r.stdout.strip())["status"] == "usage_error"
