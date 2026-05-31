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
    emailStatus: "usable" as "usable" | "verify" | "not_usable"
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
    expect(calls.some((call) => call.table === "scout_action_events" && call.op === "insert")).toBe(true);
  });

  it("met une routine Core en file via agent_tasks", async () => {
    reset();

    const result = await recordScoutAction({ action: "launch_core" });

    expect(result.ok).toBe(true);
    expect(calls.some((call) => call.table === "scout_agent_tasks" && call.op === "insert")).toBe(true);
  });

  it("ajoute un do-not-contact et bloque le lead", async () => {
    reset();

    const result = await recordScoutAction({ action: "add_do_not_contact", leadId: "core-cambon" });

    expect(result.ok).toBe(true);
    expect(calls.some((call) => call.table === "scout_do_not_contact" && call.op === "insert")).toBe(true);
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
      payload: {
        scope: "company",
        company_id: "company-1",
        source: "reply",
        reason: "Réponse négative : ne pas relancer."
      }
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
    expect(calls).toContainEqual({ table: "scout_messages", op: "update", payload: { status: "approved" } });
    expect(calls.some((call) => JSON.stringify(call.payload).includes("sent"))).toBe(false);
  });

  it("bloque le marquage utilise si l'email n'est pas utilisable", async () => {
    reset();
    state.emailStatus = "verify";

    const result = await recordScoutAction({ action: "mark_message_used", leadId: "core-cambon" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("email contact à vérifier");
    expect(calls).not.toContainEqual({ table: "scout_messages", op: "update", payload: { status: "approved" } });
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
  });
});

function reset() {
  calls.length = 0;
  state.dnc = false;
  state.blockingOutcome = false;
  state.messageStatus = "proposed";
  state.messageBody = "Bonjour, message spécifique.";
  state.emailStatus = "usable";
}

function fakeTable(table: string) {
  const chain = {
    error: null,
    data: table === "scout_companies" ? { id: "company-1" } : null,
    select: () => chain,
    or: () => chain,
    order: () => chain,
    in: () => chain,
    limit: () => chain,
    maybeSingle: () => ({ data: singleRow(table), error: null }),
    eq: () => chain,
    neq: () => chain,
    insert: (payload: unknown) => {
      calls.push({ table, op: "insert", payload });
      return chain;
    },
    update: (payload: unknown) => {
      calls.push({ table, op: "update", payload });
      return chain;
    }
  };
  return chain;
}

function singleRow(table: string) {
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
  return { id: "company-1", domain: "example.com" };
}
