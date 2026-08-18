# test/integration/test_browser.py
import pytest
from pylib import browser

pytestmark = pytest.mark.integration


def test_open_page_loads_fixture(fixture_server):
    session = browser.open_page(f"{fixture_server}/static-article.html",
                                viewport={"width": 1280, "height": 800})
    try:
        session.page.locator("h1").wait_for(state="visible", timeout=5000)
        assert session.page.title() == "示例文章"
    finally:
        session.close()
