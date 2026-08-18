# test/unit/test_env.py
import hashlib
from pathlib import Path

from pylib import env


def test_url_to_dir_name_vectors():
    assert env.url_to_dir_name("https://example.com/a?b=1") == "https___example_com_a_b_1"
    assert env.url_to_dir_name("http://127.0.0.1:8000/x.html#frag") == "http___127_0_0_1_8000_x_html_frag"
    assert env.url_to_dir_name("https://example.com/中文") == "https___example_com___"


def test_url_to_dir_name_long():
    url = "https://example.com/" + "a" * 101
    name = env.url_to_dir_name(url)
    assert len(name) == 128
    assert name.startswith("https___example_com_" + "a" * 100)
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:8]
    assert name[120:] == digest


def test_working_root_override(tmp_path, monkeypatch):
    monkeypatch.setenv("U2M_WORKING_ROOT", str(tmp_path))
    assert env.working_root() == tmp_path
    assert env.storage_state_path() == tmp_path / "cookies" / "storage_state.json"


def test_ensure_workflow_dirs(tmp_path, monkeypatch):
    monkeypatch.setenv("U2M_WORKING_ROOT", str(tmp_path))
    dirs = env.ensure_workflow_dirs("https://example.com/a", "node_workflow")
    for k in ("wf", "assets", "draft", "complex", "images"):
        assert dirs[k].is_dir(), f"缺目录 {k}"
    assert dirs["manifest"] == dirs["assets"] / "manifest.json"
