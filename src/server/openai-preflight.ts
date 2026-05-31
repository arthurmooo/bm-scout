export type OpenAiPreflightSource = "openai_responses" | "missing_env" | "network_error";

export interface OpenAiPreflightArtifact {
  status: "pass" | "fail";
  source: OpenAiPreflightSource;
  generated_at: string;
  code_revision: string;
  has_openai_env: boolean;
  model: string;
  http_status?: number;
  error_type?: string;
  error_code?: string;
  blockers: string[];
}

export function classifyOpenAiPreflightFailure(input: {
  httpStatus?: number;
  errorType?: string;
  errorCode?: string;
  message?: string;
}): string {
  const normalized = [input.errorCode, input.errorType, input.message].filter(Boolean).join(" ").toLowerCase();
  if (input.httpStatus === 401 || normalized.includes("invalid_api_key")) {
    return "OpenAI preflight échoué : clé API invalide ou non autorisée.";
  }
  if (input.httpStatus === 429 || normalized.includes("insufficient_quota") || normalized.includes("exceeded your current quota")) {
    return "OpenAI preflight échoué : quota/billing insuffisant pour exécuter les runs Agents SDK.";
  }
  if (input.httpStatus && input.httpStatus >= 500) {
    return `OpenAI preflight échoué : erreur serveur OpenAI ${input.httpStatus}.`;
  }
  if (normalized.includes("timeout") || normalized.includes("aborted")) {
    return "OpenAI preflight échoué : timeout réseau avant réponse modèle.";
  }
  return "OpenAI preflight échoué : disponibilité modèle non prouvée.";
}
