from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from .schemas import FeedbackEvent, FeedbackKind, MissionOutput


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    service_role_key: str

    @classmethod
    def from_env(cls) -> "SupabaseConfig | None":
        url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            return None
        return cls(url=url.rstrip("/"), service_role_key=key)


class SupabaseMemory:
    def __init__(self, config: SupabaseConfig):
        self.config = config

    def persist_output(self, output: MissionOutput) -> None:
        self.post_json(
            "rpc/scout_persist_mission_output",
            {"payload": output.model_dump(mode="json")},
        )

    def load_feedback_events(self, limit: int = 20) -> list[FeedbackEvent]:
        feedback_rows = self.get_json(
            "scout_feedback",
            {
                "select": "id,company_id,kind,note,created_at",
                "order": "created_at.desc",
                "limit": str(limit),
            },
        )
        outcome_rows = self.get_json(
            "scout_outcomes",
            {
                "select": "id,company_id,outcome,note,occurred_at",
                "order": "occurred_at.desc",
                "limit": str(limit),
            },
        )
        events = [self._feedback_event(row) for row in feedback_rows]
        events.extend(self._outcome_event(row) for row in outcome_rows)
        return sorted(events, key=lambda event: event.created_at, reverse=True)[:limit]

    def _feedback_event(self, row: dict[str, Any]) -> FeedbackEvent:
        return FeedbackEvent(
            id=str(row["id"]),
            lead_id=str(row.get("company_id") or "unknown"),
            kind=row["kind"],
            note=row["note"],
            created_at=row["created_at"],
        )

    def _outcome_event(self, row: dict[str, Any]) -> FeedbackEvent:
        outcome = str(row.get("outcome") or "")
        kind: FeedbackKind = "positive_outcome" if outcome in {"interested", "meeting_booked"} else "negative_outcome"
        return FeedbackEvent(
            id=f"outcome-{row['id']}",
            lead_id=str(row.get("company_id") or "unknown"),
            kind=kind,
            note=str(row.get("note") or f"Outcome: {outcome}"),
            created_at=row["occurred_at"],
        )

    def get_json(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode(params)
        return self.request_json(f"{path}?{query}", method="GET")

    def post_json(self, path: str, payload: dict[str, Any]) -> Any:
        return self.request_json(path, method="POST", payload=payload)

    def request_json(self, path: str, *, method: str, payload: dict[str, Any] | None = None) -> Any:
        url = f"{self.config.url}/rest/v1/{path}"
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8") if payload is not None else None,
            headers={
                "apikey": self.config.service_role_key,
                "authorization": f"Bearer {self.config.service_role_key}",
                "content-type": "application/json",
            },
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase request failed for {path}: {error.code} {body}") from error
        return json.loads(body) if body else None
