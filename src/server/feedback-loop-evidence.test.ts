import { describe, expect, it } from "vitest";
import {
  analyzeFeedbackLoopEvidence,
  feedbackLoopScenarioSeeds,
  feedbackLoopWorkerEnv
} from "./feedback-loop-evidence";

describe("feedback loop evidence", () => {
  it("prépare un run configured explicite sans le faire passer pour un provider marché", () => {
    const env = feedbackLoopWorkerEnv();

    expect(env.BM_SCOUT_PROVIDER).toBe("configured");
    expect(JSON.parse(env.BM_SCOUT_REAL_SEEDS)).toEqual(feedbackLoopScenarioSeeds());
    expect(feedbackLoopScenarioSeeds()).toHaveLength(3);
  });

  it("valide une preuve feedback Supabase avec impacts structurés", () => {
    const analysis = analyzeFeedbackLoopEvidence(
      [
        {
          step: "runner_complete",
          payload: {
            feedback_memory_source: "supabase",
            feedback_event_count: 5,
            do_not_contact_event_count: 1,
            started_at: "2026-05-31T10:00:00.000Z",
            completed_at: "2026-05-31T10:01:00.000Z",
            duration_ms: 1000,
            real_mode: true,
            python_version: "3.14.2",
            openai_agents_version: "0.17.4",
            openai_sdk_version: "2.14.0",
            code_revision: "abcdef123456"
          }
        },
        {
          step: "feedback_memory",
          event_type: "tool_call",
          payload: {
            feedback_event_count: 5
          }
        },
        {
          step: "feedback_memory_effects",
          event_type: "tool_call",
          payload: {
            impact_count: 2,
            score_changed_count: 1,
            blocked_count: 1,
            blocked_do_not_contact_count: 1,
            message_regenerated_count: 1,
            angle_reinforced_count: 1,
            segment_delta_count: 1
          }
        },
        { step: "persist_complete", event_type: "supabase_persist" }
      ],
      "abcdef1234567890"
    );

    expect(analysis.status).toBe("pass");
    expect(analysis.runtime.runtimeProvider).toBe("configured");
    expect(analysis.runtime.feedbackImpactCount).toBe(2);
  });

  it("refuse une preuve feedback sans impact causal", () => {
    const analysis = analyzeFeedbackLoopEvidence(
      [
        {
          step: "runner_complete",
          payload: {
            feedback_memory_source: "supabase",
            feedback_event_count: 5,
            do_not_contact_event_count: 1,
            started_at: "2026-05-31T10:00:00.000Z",
            completed_at: "2026-05-31T10:01:00.000Z",
            duration_ms: 1000,
            real_mode: true,
            python_version: "3.14.2",
            openai_agents_version: "0.17.4",
            openai_sdk_version: "2.14.0",
            code_revision: "abcdef123456"
          }
        },
        {
          step: "feedback_memory_effects",
          event_type: "tool_call",
          payload: {
            impact_count: 0,
            score_changed_count: 0,
            blocked_count: 0,
            message_regenerated_count: 0,
            angle_reinforced_count: 0
          }
        },
        { step: "persist_complete", event_type: "supabase_persist" }
      ],
      "abcdef1234567890"
    );

    expect(analysis.status).toBe("fail");
    expect(analysis.blockers).toContain("Aucun impact feedback structuré mesuré.");
    expect(analysis.blockers).toContain("Aucun effet causal score/message/blocage/angle mesuré.");
  });
});
