import { describe, expect, it, vi } from "vitest";
import { recordScoutAction } from "./scout-actions";

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; payload?: unknown }>
}));

const { state } = vi.hoisted(() => ({
  state: {
    dnc: false,
    blockingOutcome: false,
    messageStatus: "proposed",
    messageBody: "Bonjour, message spécifique.",
    emailStatus: "usable" as "usable" | "verify" | "not_usable",
    taskInsertError: false,
    lastTaskPayload: null as unknown
  }
}));

vi.mock("./supabase", () => ({
  createServerSupabaseClient: () => ({
    from: (table: string) => fakeTable(table),
    rpc: (fn: string, payload: unknown) => {
      calls.push({ table: `rpc:${fn}`, op: "rpc", payload });
      return { data: state.dnc, error: null };
    }
  })
}));

describe("scout actions", () => {
  it("persiste une validation lead et trace l'action", async () => {
    reset();

    const result = await recordScoutAction({ action: "validate_lead", leadId: "core-cambon" });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({ table: "scout_companies", op: "update", payload: { verdict: "validate" } });
    expect(calls).toContainEqual({
      table: "scout_feedback",
      op: "insert",
      payload: {
        company_id: "company-1",
        kind: "good_lead",
        note: "Lead validé par Romu."
      }
    });
    expect(calls.some((call) => call.table === "scout_action_events" && call.op === "insert")).toBe(true);
  });

  it("met une routine Core en file via agent_tasks", async () => {
    reset();

    const result = await recordScoutAction({ action: "launch_core" });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual(
      expect.objectContaining({
        table: "scout_agent_tasks",
        op: "insert",
        payload: expect.objectContaining({ type: "weekly_core_research", status: "queued" })
      })
    );
    expect(
      calls.some(
        (call) =>
          call.table === "scout_action_events" &&
          call.op === "insert" &&
          JSON.stringify(call.payload).includes('"taskId":"task-1"') &&
          JSON.stringify(call.payload).includes('"taskType":"weekly_core_research"') &&
          JSON.stringify(call.payload).includes('"taskStatus":"queued"')
      )
    ).toBe(true);
  });

  it("ne transforme pas un lancement de routine avec leadId en mutation de lead", async () => {
    reset();

    const result = await recordScoutAction({ action: "launch_core", leadId: "core-cambon" });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual(
      expect.objectContaining({
        table: "scout_agent_tasks",
        op: "insert",
        payload: expect.objectContaining({ type: "weekly_core_research", status: "queued" })
      })
    );
    expect(calls).not.toContainEqual({ table: "scout_companies", op: "update", payload: { verdict: "validate" } });
    expect(calls.some((call) => call.table === "scout_feedback")).toBe(false);
    expect(
      calls.some(
        (call) =>
          call.table === "scout_action_events" &&
          call.op === "insert" &&
          JSON.stringify(call.payload).includes('"leadId":"core-cambon"') &&
          JSON.stringify(call.payload).includes('"taskId":"task-1"') &&
          JSON.stringify(call.payload).includes('"taskType":"weekly_core_research"')
      )
    ).toBe(true);
  });

  it("trace un echec de mise en file de routine", async () => {
    reset();
    state.taskInsertError = true;

    const result = await recordScoutAction({ action: "launch_core" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Queue indisponible");
    expect(calls).toContainEqual(
      expect.objectContaining({
        table: "scout_action_events",
        op: "insert",
        payload: expect.objectContaining({
          action: "launch_core",
          payload: expect.objectContaining({
            ok: false,
            error: "Queue indisponible"
          })
        })
      })
    );
  });

  it("met les routines DNC et relances en file sans lead", async () => {
    reset();

    const dnc = await recordScoutAction({ action: "launch_dnc_check" });
    const followup = await recordScoutAction({ action: "launch_followup_review" });

    expect(dnc.ok).toBe(true);
    expect(followup.ok).toBe(true);
    expect(calls).toContainEqual(
      expect.objectContaining({
        table: "scout_agent_tasks",
        op: "insert",
        payload: expect.objectContaining({ type: "dnc_check", status: "queued" })
      })
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        table: "scout_agent_tasks",
        op: "insert",
        payload: expect.objectContaining({ type: "followup_review", status: "queued" })
      })
    );
  });

  it("ajoute un do-not-contact et bloque le lead", async () => {
    reset();

    const result = await recordScoutAction({ action: "add_do_not_contact", leadId: "core-cambon" });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({
      table: "scout_do_not_contact",
      op: "insert",
      payload: [
        {
          scope: "company",
          company_id: "company-1",
          source: "manual",
          reason: "Ajout manuel Romu."
        },
        {
          scope: "domain",
          normalized_domain: "example.com",
          company_id: "company-1",
          source: "manual",
          reason: "Ajout manuel Romu."
        },
        {
          scope: "contact",
          contact_id: "contact-1",
          company_id: "company-1",
          normalized_email_hash: "hash-romu",
          source: "manual",
          reason: "Ajout manuel Romu."
        }
      ]
    });
    expect(
      calls.some(
        (call) =>
          call.table === "scout_feedback" &&
          call.op === "insert" &&
          JSON.stringify(call.payload).includes("do_not_contact")
      )
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.table === "scout_companies" &&
          call.op === "update" &&
          JSON.stringify(call.payload).includes("blocked")
      )
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.table === "scout_action_events" &&
          call.op === "insert" &&
          JSON.stringify(call.payload).includes('"dncScopes":["company","domain","contact"]')
      )
    ).toBe(true);
  });

  it("enregistre un feedback bon angle dans scout_feedback", async () => {
    reset();

    const result = await recordScoutAction({
      action: "feedback_good_angle",
      leadId: "core-cambon",
      note: "Très bon angle reporting deal-by-deal."
    });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({
      table: "scout_feedback",
      op: "insert",
      payload: {
        company_id: "company-1",
        kind: "good_angle",
        note: "Très bon angle reporting deal-by-deal."
      }
    });
  });

  it("persiste les rejets et exclusions comme feedbacks bad_lead exploitables", async () => {
    reset();

    const rejected = await recordScoutAction({
      action: "reject_lead",
      leadId: "core-cambon",
      reason: "Mauvais secteur pour cette semaine."
    });
    const excluded = await recordScoutAction({
      action: "exclude_lead",
      leadId: "core-cambon",
      reason: "À exclure : déjà contacté."
    });

    expect(rejected.ok).toBe(true);
    expect(excluded.ok).toBe(true);
    expect(calls).toContainEqual({
      table: "scout_feedback",
      op: "insert",
      payload: {
        company_id: "company-1",
        kind: "bad_lead",
        note: "Mauvais secteur pour cette semaine."
      }
    });
    expect(calls).toContainEqual({
      table: "scout_feedback",
      op: "insert",
      payload: {
        company_id: "company-1",
        kind: "bad_lead",
        note: "À exclure : déjà contacté."
      }
    });
  });

  it("place un lead en surveillance sans l'assimiler a un opt-out", async () => {
    reset();

    const result = await recordScoutAction({
      action: "watch_lead",
      leadId: "core-cambon",
      note: "À surveiller : à retenter plus tard."
    });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({ table: "scout_companies", op: "update", payload: { verdict: "watch" } });
    expect(calls).toContainEqual({
      table: "scout_outcomes",
      op: "insert",
      payload: {
        company_id: "company-1",
        outcome: "not_now",
        note: "À surveiller : à retenter plus tard."
      }
    });
    expect(calls.some((call) => call.table === "scout_do_not_contact")).toBe(false);
  });

  it("rejette les messages quand Romu signale un message trop generique", async () => {
    reset();

    const result = await recordScoutAction({
      action: "feedback_generic_message",
      leadId: "core-cambon",
      note: "Message trop générique."
    });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({
      table: "scout_feedback",
      op: "insert",
      payload: {
        company_id: "company-1",
        kind: "generic_message",
        note: "Message trop générique."
      }
    });
    expect(calls).toContainEqual({ table: "scout_messages", op: "update", payload: { status: "rejected" } });
  });

  it("persiste un outcome RDV pris", async () => {
    reset();

    const result = await recordScoutAction({
      action: "outcome_meeting_booked",
      leadId: "core-cambon",
      note: "RDV pris avec le bon sponsor."
    });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({
      table: "scout_outcomes",
      op: "insert",
      payload: {
        company_id: "company-1",
        outcome: "meeting_booked",
        note: "RDV pris avec le bon sponsor."
      }
    });
    expect(calls).toContainEqual({ table: "scout_companies", op: "update", payload: { verdict: "validate" } });
  });

  it("hard-gate les relances apres un outcome negatif", async () => {
    reset();

    const result = await recordScoutAction({
      action: "outcome_negative",
      leadId: "core-cambon",
      note: "Réponse négative : ne pas relancer."
    });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({
      table: "scout_outcomes",
      op: "insert",
      payload: {
        company_id: "company-1",
        outcome: "negative",
        note: "Réponse négative : ne pas relancer."
      }
    });
    expect(calls).toContainEqual({
      table: "scout_companies",
      op: "update",
      payload: {
        verdict: "reject",
        quality_decision: "blocked",
        rejection_reason: "Réponse négative : ne pas relancer."
      }
    });
    expect(calls).toContainEqual({
      table: "scout_do_not_contact",
      op: "insert",
      payload: [
        {
          scope: "company",
          company_id: "company-1",
          source: "reply",
          reason: "Réponse négative : ne pas relancer."
        },
        {
          scope: "domain",
          normalized_domain: "example.com",
          company_id: "company-1",
          source: "reply",
          reason: "Réponse négative : ne pas relancer."
        },
        {
          scope: "contact",
          contact_id: "contact-1",
          company_id: "company-1",
          normalized_email_hash: "hash-romu",
          source: "reply",
          reason: "Réponse négative : ne pas relancer."
        }
      ]
    });
    expect(calls).toContainEqual({ table: "scout_messages", op: "update", payload: { status: "blocked" } });
    expect(
      calls.some(
        (call) =>
          call.table === "scout_feedback" &&
          call.op === "insert" &&
          JSON.stringify(call.payload).includes("do_not_contact")
      )
    ).toBe(true);
  });

  it("marque les messages comme utilises sans envoi automatique", async () => {
    reset();

    const result = await recordScoutAction({ action: "mark_message_used", leadId: "core-cambon" });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({ table: "scout_messages", op: "update", payload: { status: "used_manually" } });
    expect(calls).toContainEqual({ table: "scout_messages", op: "in", payload: { column: "id", values: ["message-1"] } });
    expect(calls).not.toContainEqual({ table: "scout_messages", op: "update", payload: { status: "approved" } });
    expect(
      calls.some(
        (call) =>
          call.table === "scout_action_events" &&
          call.op === "insert" &&
          JSON.stringify(call.payload).includes('"messageIds":["message-1"]')
      )
    ).toBe(true);
    expect(calls.some((call) => JSON.stringify(call.payload).includes("sent"))).toBe(false);
  });

  it("bloque le marquage utilise si l'email n'est pas utilisable", async () => {
    reset();
    state.emailStatus = "verify";

    const result = await recordScoutAction({ action: "mark_message_used", leadId: "core-cambon" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("email contact à vérifier");
    expect(calls).not.toContainEqual({ table: "scout_messages", op: "update", payload: { status: "used_manually" } });
  });

  it("bloque la copie de message si la cible est do-not-contact", async () => {
    reset();
    state.dnc = true;

    const result = await recordScoutAction({ action: "copy_email", leadId: "core-cambon" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("do-not-contact");
    expect(calls).toContainEqual({
      table: "rpc:scout_is_do_not_contact",
      op: "rpc",
      payload: {
        input_email: "romu@example.com",
        input_domain: "example.com",
        input_company_id: "company-1",
        input_contact_id: "contact-1"
      }
    });
    expect(calls).not.toContainEqual({ table: "scout_messages", op: "update", payload: { status: "copied" } });
    expect(
      calls.some(
        (call) =>
          call.table === "scout_action_events" &&
          call.op === "insert" &&
          JSON.stringify(call.payload).includes("Copie bloquée")
      )
    ).toBe(true);
  });

  it("renvoie au client le message autorisé sans persister le corps dans la trace", async () => {
    reset();
    state.messageBody = "Bonjour Arthur, message serveur autorisé et spécifique.";

    const result = await recordScoutAction({ action: "copy_email", leadId: "core-cambon" });

    expect(result.ok).toBe(true);
    expect(result.copyText).toBe("Bonjour Arthur, message serveur autorisé et spécifique.");
    const event = calls.find((call) => call.table === "scout_action_events" && call.op === "insert");
    expect(JSON.stringify(event?.payload)).toContain('"message_id":"message-1"');
    expect(JSON.stringify(event?.payload)).toContain('"messageId":"message-1"');
    expect(JSON.stringify(event?.payload)).not.toContain("message serveur autorisé");
  });

  it("bloque la copie si un outcome negatif existe meme sans DNC explicite", async () => {
    reset();
    state.blockingOutcome = true;

    const result = await recordScoutAction({ action: "copy_follow_up", leadId: "core-cambon" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("outcome négatif");
    expect(calls).not.toContainEqual({ table: "scout_messages", op: "update", payload: { status: "copied" } });
    expect(calls.some((call) => call.table === "rpc:scout_is_do_not_contact")).toBe(false);
  });

  it("bloque la copie d'un brouillon QC bloque", async () => {
    reset();
    state.messageStatus = "blocked";
    state.messageBody = "Brouillon bloqué : signal insuffisant.";

    const result = await recordScoutAction({ action: "copy_email", leadId: "core-cambon" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Quality Control");
    expect(calls.some((call) => call.table === "rpc:scout_is_do_not_contact")).toBe(false);
    expect(calls).not.toContainEqual({ table: "scout_messages", op: "update", payload: { status: "copied" } });
  });

  it("bloque la copie email si l'adresse est seulement a verifier", async () => {
    reset();
    state.emailStatus = "verify";

    const result = await recordScoutAction({ action: "copy_email", leadId: "core-cambon" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("email contact à vérifier");
    expect(calls.some((call) => call.table === "rpc:scout_is_do_not_contact")).toBe(false);
    expect(calls).not.toContainEqual({ table: "scout_messages", op: "update", payload: { status: "copied" } });
  });

  it("bloque la copie de relance si l'adresse est non utilisable", async () => {
    reset();
    state.emailStatus = "not_usable";

    const result = await recordScoutAction({ action: "copy_follow_up", leadId: "core-cambon" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("email contact à vérifier");
    expect(calls).not.toContainEqual({ table: "scout_messages", op: "update", payload: { status: "copied" } });
  });

  it("autorise la copie LinkedIn meme si l'email reste a verifier", async () => {
    reset();
    state.emailStatus = "verify";

    const result = await recordScoutAction({ action: "copy_linkedin", leadId: "core-cambon" });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({ table: "scout_messages", op: "update", payload: { status: "copied" } });
    expect(calls).toContainEqual({ table: "scout_messages", op: "eq", payload: { column: "id", value: "message-1" } });
    expect(
      calls.some(
        (call) =>
          call.table === "scout_action_events" &&
          call.op === "insert" &&
          JSON.stringify(call.payload).includes('"message_id":"message-1"') &&
          JSON.stringify(call.payload).includes('"channel":"linkedin"') &&
          JSON.stringify(call.payload).includes('"messageId":"message-1"')
      )
    ).toBe(true);
  });
});

function reset() {
  calls.length = 0;
  state.dnc = false;
  state.blockingOutcome = false;
  state.messageStatus = "proposed";
  state.messageBody = "Bonjour, message spécifique.";
  state.emailStatus = "usable";
  state.taskInsertError = false;
  state.lastTaskPayload = null;
}

function fakeTable(table: string) {
  const chain = {
    error: null,
    data: table === "scout_companies" ? { id: "company-1" } : null,
    select: () => chain,
    or: () => chain,
    order: () => chain,
    in: (column: string, values: unknown[]) => {
      calls.push({ table, op: "in", payload: { column, values } });
      return chain;
    },
    limit: () => chain,
    maybeSingle: () => singleResult(table),
    eq: (column: string, value: unknown) => {
      calls.push({ table, op: "eq", payload: { column, value } });
      return chain;
    },
    neq: () => chain,
    insert: (payload: unknown) => {
      calls.push({ table, op: "insert", payload });
      if (table === "scout_agent_tasks") state.lastTaskPayload = payload;
      return chain;
    },
    update: (payload: unknown) => {
      calls.push({ table, op: "update", payload });
      return chain;
    }
  };
  return chain;
}

function singleResult(table: string) {
  if (table === "scout_agent_tasks" && state.taskInsertError) {
    return { data: null, error: { message: "Queue indisponible" } };
  }
  return { data: singleRow(table), error: null };
}

function singleRow(table: string) {
  if (table === "scout_agent_tasks") {
    const task = state.lastTaskPayload as { type?: string; status?: string } | null;
    return { id: "task-1", type: task?.type ?? "weekly_core_research", status: task?.status ?? "queued" };
  }
  if (table === "scout_messages") {
    return {
      id: "message-1",
      status: state.messageStatus,
      body: state.messageBody,
      contact_id: "contact-1",
      scout_contacts: { email: "romu@example.com", email_status: state.emailStatus, email_type: "public_named" },
      scout_companies: { domain: "example.com" }
    };
  }
  if (table === "scout_outcomes") {
    return state.blockingOutcome ? { id: "outcome-1", outcome: "negative", note: "Réponse négative." } : null;
  }
  return {
    id: "company-1",
    domain: "example.com",
    scout_contacts: [{ id: "contact-1", email_hash: "hash-romu" }]
  };
}
