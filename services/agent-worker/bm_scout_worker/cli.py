from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from agents.exceptions import OutputGuardrailTripwireTriggered

from .quality import mission_blockers
from .runner import run_bm_scout_mission
from .runtime_env import load_local_env_files


def main() -> None:
    load_local_env_files()
    parser = argparse.ArgumentParser(description="Worker agentique BM Scout V1")
    parser.add_argument("--mode", choices=["core", "exploration"], default="core")
    parser.add_argument("--include-weak", action="store_true", help="Injecte des cas faibles pour le QC négatif.")
    parser.add_argument("--real", action="store_true", help="Utilise OpenAI Agents SDK et OPENAI_API_KEY.")
    parser.add_argument("--offline", action="store_true", help="Force le chemin déterministe sans appel modèle.")
    parser.add_argument("--persist", action="store_true", help="Persiste la sortie dans Supabase via service_role serveur.")
    parser.add_argument("--artifacts-dir", default="artifacts/agent-worker", help="Dossier de sortie JSON.")
    args = parser.parse_args()

    real = args.real and not args.offline
    try:
        output = asyncio.run(
            run_bm_scout_mission(
                args.mode,
                include_weak=args.include_weak,
                real=real,
                persist=args.persist,
                artifacts_dir=Path(args.artifacts_dir),
            )
        )
    except OutputGuardrailTripwireTriggered as error:
        info = getattr(error.guardrail_result.output, "output_info", {})
        print(json.dumps({"verdict": "fail", "source": "output_guardrail", "guardrail": info}, ensure_ascii=False, indent=2))
        raise SystemExit(1) from error

    blockers = mission_blockers(output)
    print(json.dumps({"verdict": "pass" if not blockers else "fail", "blockers": blockers, "output": output.model_dump(mode="json")}, ensure_ascii=False, indent=2))
    if blockers:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
