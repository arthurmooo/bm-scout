import { describe, expect, it } from "vitest";
import {
  analyzeAgentTaskCronArtifact,
  analyzeRunnerSteps,
  analyzeSupabaseRuntimeArtifact,
  codeRevisionMatchesCurrent,
  eligibleRuntimeVerdict
} from "./readiness-evidence";

describe("readiness evidence", () => {
  it("rend eligible un runner reel avec metadata complete et revision courante", () => {
    const evidence = analyzeRunnerSteps(
      [
        {
          step: "runner_complete",
          payload: {
            feedback_memory_source: "supabase",
            bm_scout_provider: "auto",
            feedback_event_count: 4,
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
        {
          step: "openai_web_search",
          event_type: "tool_call",
          payload: {
            result_count: 15
          }
        },
        {
          step: "search_web",
          event_type: "tool_call",
          payload: {
            discovered_count: 15
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
        { step: "persist_complete", event_type: "supabase_persist" }
      ],
      "abcdef1234567890"
    );

    expect(evidence).toMatchObject({
      source: "supabase",
      runtimeProvider: "openai_web",
      feedbackEventCount: 4,
      doNotContactEventCount: 2,
      feedbackImpactCount: 2,
      feedbackScoreChangedCount: 1,
      feedbackBlockedCount: 1,
      feedbackDncBlockedCount: 1,
      dncPreGenerationBlockedCount: 1,
      feedbackMessageRegeneratedCount: 1,
      feedbackAngleReinforcedCount: 1,
      feedbackSegmentDeltaCount: 1,
      persistComplete: true,
      runtimeMetadataComplete: true,
      runtimeRevisionMatchesCurrent: true,
      runtimeCodeRevision: "abcdef123456",
      runtimeDurationMs: 60000,
      runtimeModel: "gpt-4.1-mini"
    });
  });

  it("ne classe pas les seeds configurées comme recherche marché réelle", () => {
    const evidence = analyzeRunnerSteps(
      [
        {
          step: "runner_complete",
          payload: {
            feedback_memory_source: "supabase",
            bm_scout_provider: "auto",
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
            feedback_event_count: 3
          }
        }
      ],
      "abcdef1234567890"
    );

    expect(evidence.runtimeProvider).toBe("configured");
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

  it("ne rend pass qu'un artefact runtime complet sur la révision courante", () => {
    expect(eligibleRuntimeVerdict("pass", true, true)).toBe("pass");
    expect(eligibleRuntimeVerdict("pass", false, true)).toBe("fail");
    expect(eligibleRuntimeVerdict("pass", true, false)).toBe("fail");
    expect(eligibleRuntimeVerdict("fail", true, true)).toBe("fail");
  });

  it("accepte une preuve Supabase runtime complete sur la revision courante", () => {
    const evidence = analyzeSupabaseRuntimeArtifact(
      {
        status: "pass",
        generated_at: "2026-05-31T10:00:00.000Z",
        source: "supabase_live",
        code_revision: "abcdef123456",
        runCount: 1,
        leadCount: 2,
        rejectedCount: 1,
        lessonCount: 3,
        taskCount: 1,
        feedbackCount: 1,
        outcomeCount: 1,
        dncCount: 1,
        runStepCount: 1,
        actionEventCount: 1,
        persistenceDedupeVerified: true,
        persistenceDedupeCompanyCount: 1,
        persistenceDedupeRetainedMode: "core",
        persistenceDedupeRunStepCount: 1,
        persistenceDedupeCleanupRemainingCompanies: 0,
        persistenceDedupeCleanupRemainingRuns: 0,
        traces: ["trace-1"]
      },
      "abcdef1234567890"
    );

    expect(evidence).toMatchObject({
      verdict: "pass",
      runtimeMetadataComplete: true,
      runtimeRevisionMatchesCurrent: true,
      codeRevision: "abcdef123456",
      traces: ["trace-1"],
      source: "supabase_live"
    });
  });

  it("refuse une preuve Supabase ancienne ou sale", () => {
    const stale = analyzeSupabaseRuntimeArtifact(
      {
        status: "pass",
        generated_at: "2026-05-31T10:00:00.000Z",
        code_revision: "111111122222",
        runCount: 1,
        leadCount: 2,
        rejectedCount: 1,
        lessonCount: 3,
        taskCount: 1,
        feedbackCount: 1,
        outcomeCount: 1,
        dncCount: 1,
        runStepCount: 1,
        actionEventCount: 1,
        persistenceDedupeVerified: true,
        persistenceDedupeCompanyCount: 1,
        persistenceDedupeRetainedMode: "core",
        persistenceDedupeRunStepCount: 1,
        persistenceDedupeCleanupRemainingCompanies: 0,
        persistenceDedupeCleanupRemainingRuns: 0,
        traces: ["trace-1"]
      },
      "abcdef123456"
    );
    const dirty = analyzeSupabaseRuntimeArtifact(
      {
        status: "pass",
        generated_at: "2026-05-31T10:00:00.000Z",
        code_revision: "abcdef123456-dirty",
        runCount: 1,
        leadCount: 2,
        rejectedCount: 1,
        lessonCount: 3,
        taskCount: 1,
        feedbackCount: 1,
        outcomeCount: 1,
        dncCount: 1,
        runStepCount: 1,
        actionEventCount: 1,
        persistenceDedupeVerified: true,
        persistenceDedupeCompanyCount: 1,
        persistenceDedupeRetainedMode: "core",
        persistenceDedupeRunStepCount: 1,
        persistenceDedupeCleanupRemainingCompanies: 0,
        persistenceDedupeCleanupRemainingRuns: 0,
        traces: ["trace-1"]
      },
      "abcdef123456"
    );

    expect(stale.runtimeMetadataComplete).toBe(true);
    expect(stale.runtimeRevisionMatchesCurrent).toBe(false);
    expect(stale.verdict).toBe("fail");
    expect(dirty.runtimeMetadataComplete).toBe(true);
    expect(dirty.runtimeRevisionMatchesCurrent).toBe(false);
    expect(dirty.verdict).toBe("fail");
  });

  it("refuse une preuve Supabase sans metadata ou sans traces actionnables", () => {
    const evidence = analyzeSupabaseRuntimeArtifact(
      {
        status: "pass",
        code_revision: "abcdef123456",
        runCount: 1,
        leadCount: 1,
        rejectedCount: 1,
        lessonCount: 3,
        taskCount: 1,
        feedbackCount: 1,
        outcomeCount: 1,
        dncCount: 1,
        runStepCount: 1,
        actionEventCount: 0,
        traces: []
      },
      "abcdef123456"
    );

    expect(evidence.runtimeMetadataComplete).toBe(false);
    expect(evidence.runtimeRevisionMatchesCurrent).toBe(false);
    expect(evidence.verdict).toBe("fail");
  });

  it("refuse une preuve Supabase sans fusion RPC domain/Core reproductible", () => {
    const evidence = analyzeSupabaseRuntimeArtifact(
      {
        status: "pass",
        generated_at: "2026-05-31T10:00:00.000Z",
        source: "supabase_live",
        code_revision: "abcdef123456",
        runCount: 1,
        leadCount: 2,
        rejectedCount: 1,
        lessonCount: 3,
        taskCount: 1,
        feedbackCount: 1,
        outcomeCount: 1,
        dncCount: 1,
        runStepCount: 1,
        actionEventCount: 1,
        traces: ["trace-1"]
      },
      "abcdef123456"
    );

    expect(evidence.runtimeMetadataComplete).toBe(false);
    expect(evidence.verdict).toBe("fail");
    expect(evidence.blockers).toContain(
      "Preuve Supabase manquante: la RPC ne prouve pas la fusion par domaine avec priorité Core et cleanup."
    );
  });

  it("accepte une preuve cron GitHub Actions réelle avec transition completed", () => {
    const evidence = analyzeAgentTaskCronArtifact(
      {
        status: "pass",
        generated_at: "2026-05-31T10:00:00.000Z",
        source: "github_actions",
        mode: "real",
        code_revision: "abcdef123456",
        github_run_id: "1001",
        github_sha: "abcdef123456",
        has_supabase_env: true,
        has_openai_env: true,
        dueCount: 6,
        insertedCount: 6,
        skippedCount: 0,
        processedCount: 6,
        completedCount: 6,
        blockedCount: 0,
        failedCount: 0,
        recoveredCount: 0,
        requiredTaskTypes: [
          "weekly_core_research",
          "weekly_exploration_scan",
          "daily_brief",
          "learning_review",
          "dnc_check",
          "followup_review"
        ],
        taskTypes: [
          "weekly_core_research",
          "weekly_exploration_scan",
          "daily_brief",
          "learning_review",
          "dnc_check",
          "followup_review"
        ],
        completedTaskTypes: [
          "weekly_core_research",
          "weekly_exploration_scan",
          "daily_brief",
          "learning_review",
          "dnc_check",
          "followup_review"
        ],
        workerTraceTaskTypes: ["weekly_core_research", "weekly_exploration_scan"],
        traceIds: ["trace-core", "trace-exploration"]
      },
      "abcdef1234567890"
    );

    expect(evidence).toMatchObject({
      verdict: "pass",
      runtimeMetadataComplete: true,
      runtimeRevisionMatchesCurrent: true,
      source: "github_actions",
      mode: "real",
      traceIds: ["trace-core", "trace-exploration"]
    });
  });

  it("refuse une preuve cron qui ne couvre pas les six routines P0", () => {
    const evidence = analyzeAgentTaskCronArtifact(
      {
        status: "pass",
        generated_at: "2026-05-31T10:00:00.000Z",
        source: "github_actions",
        mode: "real",
        code_revision: "abcdef123456",
        github_run_id: "1001",
        github_sha: "abcdef123456",
        has_supabase_env: true,
        has_openai_env: true,
        dueCount: 1,
        insertedCount: 1,
        skippedCount: 0,
        processedCount: 1,
        completedCount: 1,
        blockedCount: 0,
        failedCount: 0,
        recoveredCount: 0,
        taskTypes: ["daily_brief"],
        completedTaskTypes: ["daily_brief"],
        traceIds: []
      },
      "abcdef123456"
    );

    expect(evidence.runtimeMetadataComplete).toBe(false);
    expect(evidence.verdict).toBe("fail");
    expect(evidence.blockers).toContain("Cron agent_tasks sans preuve complète des 6 routines P0 et des traces worker Core/Exploration.");
  });

  it("refuse une preuve cron locale, offline ou ancienne", () => {
    const local = analyzeAgentTaskCronArtifact(
      {
        status: "pass",
        generated_at: "2026-05-31T10:00:00.000Z",
        source: "local",
        mode: "real",
        code_revision: "abcdef123456",
        github_run_id: "1001",
        github_sha: "abcdef123456",
        has_supabase_env: true,
        has_openai_env: true,
        dueCount: 1,
        insertedCount: 1,
        skippedCount: 0,
        processedCount: 1,
        completedCount: 1,
        blockedCount: 0,
        failedCount: 0,
        recoveredCount: 0,
        taskTypes: ["daily_brief"],
        completedTaskTypes: ["daily_brief"]
      },
      "abcdef123456"
    );
    const offline = analyzeAgentTaskCronArtifact(
      {
        status: "pass",
        generated_at: "2026-05-31T10:00:00.000Z",
        source: "github_actions",
        mode: "offline",
        code_revision: "abcdef123456",
        github_run_id: "1001",
        github_sha: "abcdef123456",
        has_supabase_env: true,
        has_openai_env: true,
        dueCount: 1,
        insertedCount: 1,
        skippedCount: 0,
        processedCount: 1,
        completedCount: 1,
        blockedCount: 0,
        failedCount: 0,
        recoveredCount: 0,
        taskTypes: ["daily_brief"],
        completedTaskTypes: ["daily_brief"]
      },
      "abcdef123456"
    );
    const stale = analyzeAgentTaskCronArtifact(
      {
        status: "pass",
        generated_at: "2026-05-31T10:00:00.000Z",
        source: "github_actions",
        mode: "real",
        code_revision: "111111122222",
        github_run_id: "1001",
        github_sha: "111111122222",
        has_supabase_env: true,
        has_openai_env: true,
        dueCount: 6,
        insertedCount: 6,
        skippedCount: 0,
        processedCount: 6,
        completedCount: 6,
        blockedCount: 0,
        failedCount: 0,
        recoveredCount: 0,
        taskTypes: [
          "weekly_core_research",
          "weekly_exploration_scan",
          "daily_brief",
          "learning_review",
          "dnc_check",
          "followup_review"
        ],
        completedTaskTypes: [
          "weekly_core_research",
          "weekly_exploration_scan",
          "daily_brief",
          "learning_review",
          "dnc_check",
          "followup_review"
        ],
        workerTraceTaskTypes: ["weekly_core_research", "weekly_exploration_scan"],
        traceIds: ["trace-core", "trace-exploration"]
      },
      "abcdef123456"
    );

    expect(local.verdict).toBe("fail");
    expect(local.runtimeMetadataComplete).toBe(false);
    expect(offline.verdict).toBe("fail");
    expect(offline.runtimeMetadataComplete).toBe(false);
    expect(stale.runtimeMetadataComplete).toBe(true);
    expect(stale.runtimeRevisionMatchesCurrent).toBe(false);
    expect(stale.verdict).toBe("fail");
  });
});
