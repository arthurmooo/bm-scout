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
  note?: string;
  copyText?: string;
}

export function ScoutActionButton({ action, leadId, className, children, reason, note, copyText }: ScoutActionButtonProps) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function submit() {
    setState("saving");
    setMessage("");
    let result: ScoutActionResponse;
    try {
      const response = await fetch("/api/scout/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, leadId, reason, note })
      });
      result = await parseActionResponse(response);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action impossible.");
      setState("error");
      return;
    }
    if (!result.ok) {
      setMessage(result.message || "Action refusée par le serveur.");
      setState("error");
      return;
    }
    if (copyText && !result.copyText) {
      setMessage("Copie refusée : contenu serveur non autorisé.");
      setState("error");
      return;
    }
    if (result.copyText && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(result.copyText);
      } catch {
        // La trace serveur reste prioritaire si le presse-papiers navigateur est indisponible.
      }
    }
    setMessage(result.message);
    setState("done");
  }

  const title = message || (state === "error" ? "Action non persistée. Vérifier Supabase serveur." : undefined);

  return (
    <button
      className={className}
      type="button"
      onClick={submit}
      disabled={state === "saving"}
      title={title}
      aria-label={typeof children === "string" ? children : title}
    >
      {children}
      {state === "saving" ? <span className="button-state">...</span> : null}
      {state === "done" ? <span className="button-state">OK</span> : null}
      {state === "error" ? <span className="button-state">{shortErrorLabel(message)}</span> : null}
    </button>
  );
}

interface ScoutActionResponse {
  ok: boolean;
  message: string;
  copyText?: string;
}

async function parseActionResponse(response: Response): Promise<ScoutActionResponse> {
  const fallback = response.ok ? "Action persistée." : `Action refusée (${response.status}).`;
  try {
    const payload = (await response.json()) as Partial<ScoutActionResponse>;
    return {
      ok: payload.ok === true && response.ok,
      message: typeof payload.message === "string" && payload.message.trim() ? payload.message : fallback,
      copyText: typeof payload.copyText === "string" && payload.copyText.trim() ? payload.copyText : undefined
    };
  } catch {
    return { ok: false, message: fallback };
  }
}

function shortErrorLabel(message: string): string {
  if (!message) return "Erreur";
  if (message.toLowerCase().includes("do-not-contact")) return "DNC";
  if (message.toLowerCase().includes("quality control")) return "QC";
  if (message.toLowerCase().includes("email")) return "Email";
  return "Erreur";
}
