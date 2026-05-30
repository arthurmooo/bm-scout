"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { LeadActionType } from "@/domain/types";

interface ScoutActionButtonProps {
  action: LeadActionType;
  leadId?: string;
  className?: string;
  children: ReactNode;
  reason?: string;
  copyText?: string;
}

export function ScoutActionButton({ action, leadId, className, children, reason, copyText }: ScoutActionButtonProps) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");

  async function submit() {
    setState("saving");
    if (copyText && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(copyText);
      } catch {
        // La trace serveur reste prioritaire si le presse-papiers navigateur est indisponible.
      }
    }
    const response = await fetch("/api/scout/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, leadId, reason })
    });
    setState(response.ok ? "done" : "error");
  }

  return (
    <button
      className={className}
      type="button"
      onClick={submit}
      disabled={state === "saving"}
      title={state === "error" ? "Action non persistée. Vérifier Supabase serveur." : undefined}
    >
      {children}
      {state === "saving" ? <span className="button-state">...</span> : null}
      {state === "done" ? <span className="button-state">OK</span> : null}
      {state === "error" ? <span className="button-state">Erreur</span> : null}
    </button>
  );
}
