"""与 lib/env.mjs 保持字节级一致（同一 URL 必须产出同一目录名）。"""
import hashlib
import os
import re
from pathlib import Path


def project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def working_root() -> Path:
    env = os.environ.get("U2M_WORKING_ROOT")
    return Path(env).resolve() if env else project_root() / "working"


def url_to_dir_name(url: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9-]", "_", url)
    if len(sanitized) <= 120:
        return sanitized
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:8]
    return sanitized[:120] + digest


def storage_state_path() -> Path:
    return working_root() / "cookies" / "storage_state.json"


def workflow_dir(url: str, name: str) -> Path:
    return working_root() / url_to_dir_name(url) / name


def ensure_workflow_dirs(url: str, name: str) -> dict:
    wf = workflow_dir(url, name)
    assets = wf / "assets"
    dirs = {
        "wf": wf, "assets": assets, "draft": assets / "draft",
        "complex": assets / "complex", "images": assets / "images",
        "manifest": assets / "manifest.json",
    }
    for d in ("wf", "assets", "draft", "complex", "images"):
        dirs[d].mkdir(parents=True, exist_ok=True)
    return dirs
