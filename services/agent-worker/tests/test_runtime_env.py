from __future__ import annotations

import os

from bm_scout_worker.runtime_env import load_local_env_files, parse_env_line


def test_load_local_env_files_without_overriding_existing_values(tmp_path, monkeypatch) -> None:
    for key in ("BM_SCOUT_TEST_KEY", "BM_SCOUT_EXISTING_KEY", "BM_SCOUT_QUOTED_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("BM_SCOUT_EXISTING_KEY", "runtime-value")
    (tmp_path / ".env.local").write_text(
        "\n".join(
            [
                "BM_SCOUT_TEST_KEY=local-value",
                "BM_SCOUT_EXISTING_KEY=file-value",
                'BM_SCOUT_QUOTED_KEY="quoted value"',
            ]
        ),
        encoding="utf-8",
    )
    (tmp_path / ".env").write_text("BM_SCOUT_TEST_KEY=fallback-value\n", encoding="utf-8")

    try:
        result = load_local_env_files(tmp_path)

        assert result["files"] == [".env.local", ".env"]
        assert "BM_SCOUT_TEST_KEY" in result["keys"]
        assert "BM_SCOUT_EXISTING_KEY" not in result["keys"]
        assert "BM_SCOUT_QUOTED_KEY" in result["keys"]
        assert os.environ["BM_SCOUT_TEST_KEY"] == "local-value"
        assert os.environ["BM_SCOUT_EXISTING_KEY"] == "runtime-value"
        assert os.environ["BM_SCOUT_QUOTED_KEY"] == "quoted value"
    finally:
        for key in ("BM_SCOUT_TEST_KEY", "BM_SCOUT_QUOTED_KEY"):
            monkeypatch.delenv(key, raising=False)


def test_parse_env_line_accepts_safe_env_syntax() -> None:
    assert parse_env_line("OPENAI_API_KEY=placeholder-key # local") == ("OPENAI_API_KEY", "placeholder-key")
    assert parse_env_line("BAD-KEY=value") is None
    assert parse_env_line("# ignored") is None
