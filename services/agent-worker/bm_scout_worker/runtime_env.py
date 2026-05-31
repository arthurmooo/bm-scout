from __future__ import annotations

import os
import re
from pathlib import Path

DEFAULT_ENV_FILES = (".env.local", ".env")
ENV_KEY_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def load_local_env_files(cwd: str | Path | None = None, files: tuple[str, ...] = DEFAULT_ENV_FILES) -> dict[str, list[str]]:
    root = Path(cwd or Path.cwd())
    loaded_files: list[str] = []
    loaded_keys: list[str] = []

    for file_name in files:
        path = root / file_name
        if not path.exists():
            continue
        loaded_files.append(file_name)
        for line in path.read_text(encoding="utf-8").splitlines():
            parsed = parse_env_line(line)
            if not parsed:
                continue
            key, value = parsed
            if key in os.environ:
                continue
            os.environ[key] = value
            loaded_keys.append(key)

    return {"files": loaded_files, "keys": loaded_keys}


def parse_env_line(line: str) -> tuple[str, str] | None:
    trimmed = line.strip()
    if not trimmed or trimmed.startswith("#") or "=" not in trimmed:
        return None
    key, raw_value = trimmed.split("=", 1)
    key = key.strip()
    if not ENV_KEY_PATTERN.match(key):
        return None
    return key, unquote_env_value(raw_value.strip())


def unquote_env_value(value: str) -> str:
    if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
        return value[1:-1].replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")
    if len(value) >= 2 and value.startswith("'") and value.endswith("'"):
        return value[1:-1]
    comment_match = re.search(r"\s#", value)
    if comment_match:
        return value[: comment_match.start()].strip()
    return value.strip()
