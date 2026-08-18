# test/unit/test_browser_proxy.py —— 与 test/unit/browser-proxy.test.mjs 同一组向量（双语言一致）
from pylib import browser


def test_unset_or_blank():
    assert browser.proxy_launch_options({}) == {}
    assert browser.proxy_launch_options({"U2M_PROXY": ""}) == {}
    assert browser.proxy_launch_options({"U2M_PROXY": "   "}) == {}


def test_direct():
    assert browser.proxy_launch_options({"U2M_PROXY": "direct"}) == {"args": ["--no-proxy-server"]}
    assert browser.proxy_launch_options({"U2M_PROXY": " Direct "}) == {"args": ["--no-proxy-server"]}
    assert browser.proxy_launch_options({"U2M_PROXY": "DIRECT"}) == {"args": ["--no-proxy-server"]}


def test_explicit_url():
    assert browser.proxy_launch_options({"U2M_PROXY": "http://127.0.0.1:1082"}) == {
        "proxy": {"server": "http://127.0.0.1:1082"}
    }
    assert browser.proxy_launch_options({"U2M_PROXY": "socks5://127.0.0.1:1080"}) == {
        "proxy": {"server": "socks5://127.0.0.1:1080"}
    }
