from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import asdict, is_dataclass
from typing import Any, Iterator

from pydantic import BaseModel

from .schemas import RunStep

_RECORDED_TOOL_STEPS: ContextVar[list[RunStep] | None] = ContextVar("bm_scout_recorded_tool_steps", default=None)


@contextmanager
def capture_tool_calls() -> Iterator[list[RunStep]]:
    steps: list[RunStep] = []
    token = _RECORDED_TOOL_STEPS.set(steps)
    try:
        yield steps
    finally:
        _RECORDED_TOOL_STEPS.reset(token)


def record_tool_call(
    tool_name: str,
    inputs: dict[str, Any],
    output: Any = None,
    *,
    error: Exception | None = None,
) -> None:
    steps = _RECORDED_TOOL_STEPS.get()
    if steps is None:
        return
    payload: dict[str, object] = {"input": compact_payload(inputs)}
    if error is not None:
        payload["error"] = str(error)
    else:
        payload["output"] = compact_payload(output)
    steps.append(
        RunStep(
            agent_name="bm_scout_tool",
            step=tool_name,
            event_type="tool_error" if error else "tool_call",
            payload=payload,
        )
    )


def compact_payload(value: Any, *, max_string: int = 500, max_items: int = 8) -> object:
    if isinstance(value, BaseModel):
        return compact_payload(value.model_dump(mode="json"), max_string=max_string, max_items=max_items)
    if is_dataclass(value) and not isinstance(value, type):
        return compact_payload(asdict(value), max_string=max_string, max_items=max_items)
    if isinstance(value, dict):
        return {
            str(key): compact_payload(item, max_string=max_string, max_items=max_items)
            for key, item in list(value.items())[:max_items]
        }
    if isinstance(value, (list, tuple)):
        return [compact_payload(item, max_string=max_string, max_items=max_items) for item in list(value)[:max_items]]
    if isinstance(value, str):
        return value if len(value) <= max_string else value[:max_string] + "...[truncated]"
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)
