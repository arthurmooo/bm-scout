import { describe, expect, it } from "vitest";
import { analyzeRunnerSteps, codeRevisionMatchesCurrent } from "./readiness-evidence";

describe("readiness evidence", () => {
  it("rend eligible un runner reel avec metadata complete et revision courante", () => {
    const evidence = analyzeRunnerSteps(
      [
        {
          step: "runner_complete",
          payload: {
            feedback_memory_source: "supabase",
            do_not_contact_event_count: 2,
            started_at: "2026-05-31T10:00:00.000Z",
            completed_at: "2026-05-31T10:01:00.000Z",
            duration_ms: 60000,
            real_mode: true,
            openai_model: "gpt-4.1-mini",
            python_version: "3.12.0",
            openai_agents_version: "0.6.0",
            openai_sdk_version: "2.8.1",
            code_revision: "abcdef123456"
          }
        },
        { step: "persist_complete", event_type: "supabase_persist" }
      ],
      "abcdef1234567890"
    );

    expect(evidence).toMatchObject({
      source: "supabase",
      doNotContactEventCount: 2,
      persistComplete: true,
      runtimeMetadataComplete: true,
      runtimeRevisionMatchesCurrent: true,
      runtimeCodeRevision: "abcdef123456",
      runtimeDurationMs: 60000,
      runtimeModel: "gpt-4.1-mini"
    });
  });

  it("refuse une preuve sans mode reel ou sans version SDK", () => {
    const evidence = analyzeRunnerSteps(
      [
        {
          step: "runner_complete",
          payload: {
            feedback_memory_source: "supabase",
            started_at: "2026-05-31T10:00:00.000Z",
            completed_at: "2026-05-31T10:01:00.000Z",
            duration_ms: 60000,
            real_mode: false,
            python_version: "3.12.0",
            openai_agents_version: "unknown",
            openai_sdk_version: "2.8.1",
            code_revision: "abcdef123456"
          }
        }
      ],
      "abcdef123456"
    );

    expect(evidence.runtimeMetadataComplete).toBe(false);
    expect(evidence.runtimeRevisionMatchesCurrent).toBe(false);
  });

  it("refuse une preuve runtime complete mais produite par une ancienne revision", () => {
    const evidence = analyzeRunnerSteps(
      [
        {
          step: "runner_complete",
          payload: {
            started_at: "2026-05-31T10:00:00.000Z",
            completed_at: "2026-05-31T10:01:00.000Z",
            duration_ms: 60000,
            real_mode: true,
            python_version: "3.12.0",
            openai_agents_version: "0.6.0",
            openai_sdk_version: "2.8.1",
            code_revision: "111111122222"
          }
        }
      ],
      "abcdef123456"
    );

    expect(evidence.runtimeMetadataComplete).toBe(true);
    expect(evidence.runtimeRevisionMatchesCurrent).toBe(false);
  });

  it("compare les revisions courtes et longues prudemment", () => {
    expect(codeRevisionMatchesCurrent("abcdef123456", "abcdef1234567890")).toBe(true);
    expect(codeRevisionMatchesCurrent("abcdef1234567890", "abcdef123456")).toBe(true);
    expect(codeRevisionMatchesCurrent("abcdef123456-dirty", "abcdef123456-dirty")).toBe(false);
    expect(codeRevisionMatchesCurrent("abcdef123456", "abcdef123456-dirty")).toBe(false);
    expect(codeRevisionMatchesCurrent("abc", "abcdef123456")).toBe(false);
    expect(codeRevisionMatchesCurrent("unknown", "abcdef123456")).toBe(false);
  });
});
