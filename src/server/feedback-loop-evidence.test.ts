import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeFeedbackLoopEvidence,
  feedbackLoopLearningUsesFeedback,
  feedbackLoopOpenAiPreflightBlockers,
  feedbackLoopScenarioSeeds,
  feedbackLoopWorkerEnv
} from "./feedback-loop-evidence";

describe("feedback loop evidence", () => {
  it("prépare un run configured explicite sans le faire passer pour un provider marché", () => {
    const env = feedbackLoopWorkerEnv();

    expect(env.BM_SCOUT_PROVIDER).toBe("configured");
    expect(env.BM_SCOUT_EVIDENCE_PURPOSE).toBe("feedback_loop");
    expect(JSON.parse(env.BM_SCOUT_REAL_SEEDS)).toEqual(feedbackLoopScenarioSeeds());
    expect(feedbackLoopScenarioSeeds()).toHaveLength(3);
  });

  it("n'écrase pas l'artefact worker opérationnel Core persisté", () => {
    const script = readFileSync(join(process.cwd(), "scripts", "run-feedback-loop-evidence.ts"), "utf8");

    expect(script).toContain('evidenceDir: "artifacts/feedback-loop"');
  });

  it("court-circuite le feedback loop si le preflight OpenAI courant est bloqué", () => {
    expect(
      feedbackLoopOpenAiPreflightBlockers(
        {
          status: "fail",
          source: "openai_responses",
          generated_at: "2026-05-31T10:00:00.000Z",
          code_revision: "abcdef123456",
          has_openai_env: true,
          model: "gpt-4.1-mini",
          http_status: 429,
          error_type: "insufficient_quota",
          error_code: "insufficient_quota",
          blockers: ["OpenAI preflight échoué : quota/billing insuffisant."]
        },
        "abcdef1234567890-dirty"
      )
    ).toEqual(["OpenAI preflight échoué : quota/billing insuffisant."]);

    expect(
      feedbackLoopOpenAiPreflightBlockers(
        {
          status: "fail",
          source: "openai_responses",
          generated_at: "2026-05-31T10:00:00.000Z",
          code_revision: "oldrev",
          has_openai_env: true,
          model: "gpt-4.1-mini",
          blockers: ["Ancien blocage."]
        },
        "abcdef1234567890"
      )
    ).toEqual([]);
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
        {
          step: "dnc_pre_generation_gate",
          event_type: "tool_call",
          payload: {
            decision: "blocked",
            message_generation: "skipped"
          }
        },
        {
          step: "feedback_reject_pre_generation_gate",
          event_type: "tool_call",
          payload: {
            decision: "blocked",
            message_generation: "skipped"
          }
        },
        { step: "persist_complete", event_type: "supabase_persist" }
      ],
      "abcdef1234567890",
      validLearningLessons()
    );

    expect(analysis.status).toBe("pass");
    expect(analysis.runtime.runtimeProvider).toBe("configured");
    expect(analysis.runtime.feedbackImpactCount).toBe(2);
    expect(analysis.runtime.dncPreGenerationBlockedCount).toBe(1);
    expect(analysis.runtime.feedbackPreGenerationRejectedCount).toBe(1);
  });

  it("refuse une preuve feedback DNC sans court-circuit avant génération", () => {
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
            impact_count: 1,
            score_changed_count: 0,
            blocked_count: 1,
            blocked_do_not_contact_count: 1,
            message_regenerated_count: 0,
            angle_reinforced_count: 0
          }
        },
        { step: "persist_complete", event_type: "supabase_persist" }
      ],
      "abcdef1234567890",
      validLearningLessons()
    );

    expect(analysis.status).toBe("fail");
    expect(analysis.blockers).toContain(
      "Do-not-contact chargé sans preuve `dnc_pre_generation_gate` avant génération d'outreach."
    );
  });

  it("refuse une preuve feedback négatif sans court-circuit avant génération", () => {
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
            impact_count: 1,
            score_changed_count: 0,
            blocked_count: 1,
            blocked_do_not_contact_count: 0,
            message_regenerated_count: 0,
            angle_reinforced_count: 0
          }
        },
        {
          step: "dnc_pre_generation_gate",
          event_type: "tool_call",
          payload: {
            decision: "blocked",
            message_generation: "skipped"
          }
        },
        { step: "persist_complete", event_type: "supabase_persist" }
      ],
      "abcdef1234567890",
      validLearningLessons()
    );

    expect(analysis.status).toBe("fail");
    expect(analysis.blockers).toContain(
      "Feedback négatif chargé sans preuve `feedback_reject_pre_generation_gate` avant génération d'outreach."
    );
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
      "abcdef1234567890",
      validLearningLessons()
    );

    expect(analysis.status).toBe("fail");
    expect(analysis.blockers).toContain("Aucun impact feedback structuré mesuré.");
    expect(analysis.blockers).toContain("Aucun effet causal score/message/blocage/angle mesuré.");
  });

  it("refuse une preuve feedback sans apprentissages exploitables", () => {
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
            impact_count: 1,
            score_changed_count: 1,
            blocked_count: 0,
            message_regenerated_count: 0,
            angle_reinforced_count: 0
          }
        },
        { step: "persist_complete", event_type: "supabase_persist" }
      ],
      "abcdef1234567890",
      [{ lesson: "Apprentissage générique", recommendation: "Continuer comme avant." }]
    );

    expect(analysis.status).toBe("fail");
    expect(analysis.blockers).toContain(
      "Learning Agent sans synthèse 3-5 apprentissages exploitant feedback Romu et do-not-contact."
    );
  });

  it("identifie les apprentissages feedback Romu + do-not-contact", () => {
    expect(feedbackLoopLearningUsesFeedback(validLearningLessons())).toBe(true);
    expect(feedbackLoopLearningUsesFeedback(validLearningLessons().slice(0, 2))).toBe(false);
  });
});

function validLearningLessons() {
  return [
    {
      lesson: "Feedback Romu : les comptes M&A avec signaux deal-flow méritent un bonus.",
      recommendation: "Renforcer les angles deal-by-deal et documents."
    },
    {
      lesson: "Feedback Romu : les messages trop génériques doivent être régénérés.",
      recommendation: "Citer un signal observé avant toute proposition."
    },
    {
      lesson: "Do-not-contact actif sur un compte témoin.",
      recommendation: "Bloquer toute relance et remonter le do-not-contact en QC."
    }
  ];
}
