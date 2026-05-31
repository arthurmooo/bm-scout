from __future__ import annotations

import os
import subprocess
from importlib.metadata import PackageNotFoundError, version


def package_version(package_name: str) -> str:
    try:
        return version(package_name)
    except PackageNotFoundError:
        return "unknown"


def code_revision() -> str:
    configured = os.getenv("BM_SCOUT_CODE_REVISION") or os.getenv("GITHUB_SHA") or os.getenv("VERCEL_GIT_COMMIT_SHA")
    if configured:
        return configured[:40]
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=2,
        )
    except Exception:
        return "unknown"
    revision = result.stdout.strip()
    if not revision:
        return "unknown"
    try:
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            check=True,
            capture_output=True,
            text=True,
            timeout=2,
        )
    except Exception:
        return revision
    return f"{revision}-dirty" if status.stdout.strip() else revision
