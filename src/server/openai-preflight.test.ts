import { describe, expect, it } from "vitest";
import { classifyOpenAiPreflightFailure } from "./openai-preflight";

describe("openai preflight", () => {
  it("classe clairement les erreurs de quota", () => {
    expect(
      classifyOpenAiPreflightFailure({
        httpStatus: 429,
        errorCode: "insufficient_quota",
        message: "You exceeded your current quota"
      })
    ).toContain("quota/billing insuffisant");
  });

  it("distingue clé invalide, serveur et timeout", () => {
    expect(classifyOpenAiPreflightFailure({ httpStatus: 401, errorCode: "invalid_api_key" })).toContain("clé API invalide");
    expect(classifyOpenAiPreflightFailure({ httpStatus: 503 })).toContain("erreur serveur OpenAI 503");
    expect(classifyOpenAiPreflightFailure({ message: "This operation was aborted by timeout" })).toContain("timeout réseau");
  });
});
