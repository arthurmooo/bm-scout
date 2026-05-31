import {
  Ban,
  Check,
  CircleDot,
  Clipboard,
  Compass,
  Eye,
  FileText,
  GraduationCap,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Timer,
  UserX,
  X
} from "lucide-react";
import type { ReactNode } from "react";
import type { AgentTask, LeadActionType, ScoutLead, ScoutSnapshot, StructuredInsights } from "@/domain/types";
import { ScoutActionButton } from "./ScoutActionButton";

type QuickFeedbackAction = {
  label: string;
  action: LeadActionType;
  note?: string;
  reason?: string;
  danger?: boolean;
};

type ApprovalItemType = "lead" | "email" | "follow_up" | "exploration" | "enrichment" | "qc_dnc";

type ApprovalItem = {
  id: string;
  type: ApprovalItemType;
  lead: ScoutLead;
  label: string;
  detail: string;
  primaryAction: LeadActionType;
  primaryLabel: string;
  secondaryAction: LeadActionType;
  secondaryLabel: string;
  primaryNote?: string;
  secondaryNote?: string;
  secondaryReason?: string;
  danger?: boolean;
};

const leadFeedbackActions: QuickFeedbackAction[] = [
  { label: "Très bon", action: "feedback_good_lead", note: "Très bon lead : fort potentiel, bon secteur, bon timing." },
  { label: "Bon secteur", action: "feedback_good_lead", note: "Bon secteur : à renforcer dans le scoring." },
  { label: "Bon contact", action: "feedback_good_lead", note: "Bon contact : persona exploitable pour Romu." },
  { label: "Trop petit", action: "feedback_bad_lead", note: "Mauvais lead : trop petit." },
  { label: "Mauvais secteur", action: "feedback_bad_lead", note: "Mauvais secteur pour BM Scout." },
  { label: "Douleur faible", action: "feedback_bad_lead", note: "Mauvais lead : douleur faible." },
  { label: "Peu sourcé", action: "feedback_bad_lead", note: "Mauvais lead : pas assez sourcé.", danger: true },
  { label: "Déjà contacté", action: "feedback_bad_lead", note: "Mauvais lead : déjà contacté.", danger: true },
  { label: "À surveiller", action: "watch_lead", note: "À surveiller : à retenter plus tard." },
  { label: "À exclure", action: "exclude_lead", reason: "À exclure : feedback Romu.", danger: true }
];

const messageFeedbackActions: QuickFeedbackAction[] = [
  { label: "Utilisable", action: "feedback_good_angle", note: "Message utilisable tel quel : ton direct et angle pertinent." },
  { label: "Très bon angle", action: "feedback_good_angle", note: "Très bon angle : reporting, documents et relances." },
  { label: "À raccourcir", action: "feedback_generic_message", note: "Message à raccourcir." },
  { label: "Générique", action: "feedback_generic_message", note: "Message trop générique." },
  { label: "Mauvais angle", action: "feedback_generic_message", note: "Message mauvais angle." },
  { label: "Trop IA", action: "feedback_generic_message", note: "Message trop IA." },
  { label: "Trop commercial", action: "feedback_generic_message", note: "Message trop commercial." },
  { label: "Pas direct", action: "feedback_generic_message", note: "Message pas assez direct." }
];

const navItems = [
  { label: "Aujourd'hui", icon: CircleDot, active: true },
  { label: "Core", icon: Compass },
  { label: "Explorer", icon: Search },
  { label: "Learning", icon: GraduationCap },
  { label: "Qualité", icon: ShieldCheck }
];

export function ScoutDashboard({ snapshot, accessLabel }: { snapshot: ScoutSnapshot; accessLabel?: string }) {
  const primary = snapshot.primaryLead;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">BM</div>
          <span>Scout</span>
        </div>
        <nav className="nav" aria-label="Navigation principale">
          {navItems.map((item) => (
            <a className={`nav-item ${item.active ? "active" : ""}`} href="#" key={item.label}>
              <item.icon size={18} />
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <h1>BM Scout</h1>
          <div className="topbar-right">
            <div className="topbar-status">
              <span className="status-dot" />
              {decisionCount(snapshot)} décisions attendent Romu
            </div>
            {accessLabel ? (
              <form className="logout-form" action="/auth/logout" method="post">
                <span>{accessLabel}</span>
                <button type="submit">Déconnexion</button>
              </form>
            ) : null}
          </div>
        </header>
        <section className="content">
          <div className="decision-area">
            <div className="section-title">
              <div>
                <h2>Prochaine meilleure action</h2>
                <p className="quiet">Une décision claire, puis seulement les preuves utiles. Statut : {snapshot.readiness}.</p>
              </div>
            </div>
            {primary ? <PrimaryLead lead={primary} /> : <div className="primary-card">Aucun lead prêt à arbitrer.</div>}
            <RoutineActions />
            <div className="section-title">
              <h2>Ensuite</h2>
              <span className="quiet">4 lignes maximum</span>
            </div>
            <div className="queue">
              {snapshot.queue.slice(0, 4).map((lead) => (
                <QueueRow lead={lead} key={lead.id} />
              ))}
            </div>
          </div>
          <aside className="side-panel">
            <BriefBox snapshot={snapshot} />
            <ApprovalCenter snapshot={snapshot} />
            <TaskBoard tasks={snapshot.tasks} />
            <section>
              <h2>Pourquoi maintenant</h2>
              <div className="proof-list">
                {(primary?.evidence ?? []).slice(0, 3).map((proof, index) => (
                  <div className="proof" key={`${proof.url}-${proof.label}-${index}`}>
                    <a href={proof.url} target="_blank" rel="noreferrer">{proof.label}</a>
                    <p>{proof.observedFact}</p>
                  </div>
                ))}
              </div>
            </section>
            {primary ? <QualityBox lead={primary} /> : null}
            <section>
              <h2>Learning hebdo</h2>
              <div className="learning-list">
                {snapshot.lessons.slice(0, 3).map((lesson, index) => (
                  <div className="lesson" key={lesson.id}>
                    <strong>{index + 1}. {lesson.lesson}</strong>
                    <p>{lesson.recommendation}</p>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>
        <footer className="bottom-bar">
          <span>{snapshot.brief.completed[0]}</span>
          <span>{nextRoutineLabel(snapshot.tasks)}</span>
        </footer>
      </main>
    </div>
  );
}

function PrimaryLead({ lead }: { lead: ScoutLead }) {
  return (
    <article className="primary-card">
      <div className="lead-header">
        <div className="lead-name">
          <div className="lead-logo">{initials(lead.company)}</div>
          <div className="lead-title">
            <h3>{lead.company}</h3>
            <p>{lead.segment} · {lead.website.replace("https://", "")}</p>
          </div>
        </div>
        <div className="score">{lead.score}</div>
      </div>
      <div className="decision-copy">
        <div className="decision-line">
          <span>Signal</span>
          <strong>{lead.observedSignals[0]}</strong>
        </div>
        <div className="decision-line">
          <span>Hypothèse</span>
          <span>{lead.painHypotheses[0]}</span>
        </div>
        <div className="decision-line">
          <span>Action</span>
          <span>{lead.nextAction}</span>
        </div>
        <div className="decision-line">
          <span>Contact</span>
          <span>{contactSummary(lead)}</span>
        </div>
      </div>
      <div className="action-row">
        <ScoutActionButton className="button primary" action="validate_lead" leadId={lead.id}><Check size={17} /> Valider</ScoutActionButton>
        <ScoutActionButton className="button" action="request_enrichment" leadId={lead.id}><Clipboard size={17} /> Enrichir</ScoutActionButton>
        <ScoutActionButton className="button danger" action="reject_lead" leadId={lead.id} reason="Rejet manuel Romu."><X size={17} /> Rejeter</ScoutActionButton>
        <ScoutActionButton className="button" action="copy_email" leadId={lead.id} copyText={lead.outreach.coldEmail}><Clipboard size={17} /> Copier email</ScoutActionButton>
        <ScoutActionButton className="button" action="copy_follow_up" leadId={lead.id} copyText={lead.outreach.followUp}><Clipboard size={17} /> Copier relance</ScoutActionButton>
        <ScoutActionButton className="button" action="copy_linkedin" leadId={lead.id} copyText={lead.outreach.linkedin}><Clipboard size={17} /> Copier LinkedIn</ScoutActionButton>
        <ScoutActionButton className="button" action="mark_message_used" leadId={lead.id}><Check size={17} /> Marquer utilisé</ScoutActionButton>
        <ScoutActionButton className="button danger" action="add_do_not_contact" leadId={lead.id} reason="Ajout manuel Romu depuis la console."><X size={17} /> DNC</ScoutActionButton>
      </div>
      <div className="feedback-row" aria-label="Feedback Romu">
        <ScoutActionButton className="button compact" action="feedback_good_lead" leadId={lead.id} note="Très bon lead : fit ICP confirmé par Romu."><Check size={15} /> Bon lead</ScoutActionButton>
        <ScoutActionButton className="button compact" action="feedback_good_angle" leadId={lead.id} note="Très bon angle : tâche grise entre outils."><Check size={15} /> Angle OK</ScoutActionButton>
        <ScoutActionButton className="button compact" action="feedback_generic_message" leadId={lead.id} note="Message trop générique."><Clipboard size={15} /> Générique</ScoutActionButton>
        <ScoutActionButton className="button compact" action="outcome_meeting_booked" leadId={lead.id} note="Outcome : RDV pris."><Check size={15} /> RDV</ScoutActionButton>
        <ScoutActionButton className="button compact danger" action="feedback_bad_lead" leadId={lead.id} note="Mauvais lead : à exclure du prochain scoring."><X size={15} /> Mauvais</ScoutActionButton>
        <ScoutActionButton className="button compact danger" action="outcome_negative" leadId={lead.id} note="Outcome : réponse négative."><X size={15} /> Négatif</ScoutActionButton>
      </div>
      <details className="secondary-actions">
        <summary><CircleDot size={15} /> Décisions</summary>
        <div className="secondary-action-grid">
          <ScoutActionButton className="button compact" action="watch_lead" leadId={lead.id}><Eye size={15} /> Surveiller</ScoutActionButton>
          <ScoutActionButton className="button compact" action="rerun_qc" leadId={lead.id}><RefreshCw size={15} /> Relancer QC</ScoutActionButton>
          <ScoutActionButton className="button compact" action="outcome_no_response" leadId={lead.id} note="Outcome : pas de réponse."><Timer size={15} /> Sans réponse</ScoutActionButton>
          <ScoutActionButton className="button compact" action="outcome_positive" leadId={lead.id} note="Outcome : réponse positive."><Check size={15} /> Positif</ScoutActionButton>
          <ScoutActionButton className="button compact" action="outcome_wrong_person" leadId={lead.id} note="Outcome : mauvais interlocuteur."><UserX size={15} /> Mauvais contact</ScoutActionButton>
          <ScoutActionButton className="button compact" action="outcome_bad_timing" leadId={lead.id} note="Outcome : timing mauvais, à retenter plus tard."><Timer size={15} /> Timing</ScoutActionButton>
          <ScoutActionButton className="button compact" action="outcome_pain_confirmed" leadId={lead.id} note="Outcome : douleur confirmée."><Check size={15} /> Douleur OK</ScoutActionButton>
          <ScoutActionButton className="button compact danger" action="outcome_pain_not_confirmed" leadId={lead.id} note="Outcome : douleur non confirmée."><X size={15} /> Douleur non</ScoutActionButton>
          <ScoutActionButton className="button compact danger" action="exclude_lead" leadId={lead.id} reason="Exclusion manuelle Romu."><Ban size={15} /> Exclure</ScoutActionButton>
        </div>
      </details>
      <QuickFeedbackPanel lead={lead} title="Raisons lead" icon={<CircleDot size={15} />} actions={leadFeedbackActions} />
      <QuickFeedbackPanel lead={lead} title="Feedback message" icon={<Clipboard size={15} />} actions={messageFeedbackActions} />
      <details className="deep-card">
        <summary><FileText size={17} /> Fiche profonde</summary>
        <p>{lead.deepCard}</p>
        <InsightBlock lead={lead} />
      </details>
    </article>
  );
}

function QuickFeedbackPanel({
  lead,
  title,
  icon,
  actions
}: {
  lead: ScoutLead;
  title: string;
  icon: ReactNode;
  actions: QuickFeedbackAction[];
}) {
  return (
    <details className="secondary-actions">
      <summary>{icon}{title}</summary>
      <div className="secondary-action-grid">
        {actions.map((item) => (
          <ScoutActionButton
            className={`button compact ${item.danger ? "danger" : ""}`}
            action={item.action}
            leadId={lead.id}
            note={item.note}
            reason={item.reason}
            key={`${item.action}-${item.label}`}
          >
            {item.danger ? <X size={15} /> : <Check size={15} />} {item.label}
          </ScoutActionButton>
        ))}
      </div>
    </details>
  );
}

function ApprovalCenter({ snapshot }: { snapshot: ScoutSnapshot }) {
  const items = buildApprovalItems(snapshot).slice(0, 8);

  return (
    <section>
      <h2>À valider</h2>
      <div className="approval-list">
        {items.map((item) => (
          <div className={`approval-row ${item.danger ? "danger" : ""}`} key={item.id}>
            <div>
              <span className="approval-kind">{item.label}</span>
              <strong>{item.lead.company}</strong>
              <p>{item.detail}</p>
            </div>
            <div className="approval-actions">
              <ScoutActionButton className="button compact" action={item.primaryAction} leadId={item.lead.id} note={item.primaryNote}>
                {approvalActionIcon(item.primaryAction)} {item.primaryLabel}
              </ScoutActionButton>
              <ScoutActionButton
                className={`button compact ${item.danger || item.secondaryAction === "reject_lead" ? "danger" : ""}`}
                action={item.secondaryAction}
                leadId={item.lead.id}
                note={item.secondaryNote}
                reason={item.secondaryReason}
              >
                {approvalActionIcon(item.secondaryAction)} {item.secondaryLabel}
              </ScoutActionButton>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function buildApprovalItems(snapshot: ScoutSnapshot): ApprovalItem[] {
  const leads = uniqueLeads([
    snapshot.primaryLead,
    ...snapshot.queue,
    ...snapshot.exploration,
    ...snapshot.rejected
  ]);
  const items: ApprovalItem[] = [];

  for (const lead of leads) {
    if (isDncOrOptOut(lead)) {
      items.push({
        id: `${lead.id}-qc-dnc`,
        type: "qc_dnc",
        lead,
        label: "DNC / opt-out",
        detail: lead.rejectionReason ?? "Compte bloqué : aucune relance autorisée.",
        primaryAction: "add_do_not_contact",
        primaryLabel: "Bloquer",
        secondaryAction: "rerun_qc",
        secondaryLabel: "QC",
        primaryNote: "Validation DNC depuis le centre de validation.",
        danger: true
      });
      continue;
    }

    if (lead.qualityDecision === "blocked") {
      items.push({
        id: `${lead.id}-qc-blocked`,
        type: "qc_dnc",
        lead,
        label: "Fiche bloquée",
        detail: lead.rejectionReason ?? "Sortie bloquée par Quality Control.",
        primaryAction: "request_enrichment",
        primaryLabel: "Enrichir",
        secondaryAction: "reject_lead",
        secondaryLabel: "Rejeter",
        secondaryReason: "Rejet depuis le centre de validation : fiche bloquée."
      });
      continue;
    }

    if (lead.qualityDecision === "needs_enrichment") {
      items.push({
        id: `${lead.id}-enrichment`,
        type: "enrichment",
        lead,
        label: "Enrichissement",
        detail: "Signal ou contact à renforcer avant décision.",
        primaryAction: "request_enrichment",
        primaryLabel: "Enrichir",
        secondaryAction: "rerun_qc",
        secondaryLabel: "QC"
      });
      continue;
    }

    if (lead.mode === "exploration") {
      items.push({
        id: `${lead.id}-exploration`,
        type: "exploration",
        lead,
        label: "Shortlist exploration",
        detail: "À valider comme opportunité, sans outreach direct.",
        primaryAction: "validate_lead",
        primaryLabel: "Shortlist",
        secondaryAction: "request_enrichment",
        secondaryLabel: "Enrichir",
        primaryNote: "Shortlist exploration validée par Romu."
      });
      continue;
    }

    items.push({
      id: `${lead.id}-lead`,
      type: "lead",
      lead,
      label: "Lead Core",
      detail: approvalLabel(lead),
      primaryAction: "validate_lead",
      primaryLabel: "OK",
      secondaryAction: "reject_lead",
      secondaryLabel: "Non",
      secondaryReason: "Rejet depuis le centre de validation."
    });

    if (lead.outreach.coldEmail && lead.qualityDecision === "pass") {
      items.push({
        id: `${lead.id}-email`,
        type: "email",
        lead,
        label: "Email",
        detail: "Brouillon à copier seulement si le serveur confirme QC, email et DNC.",
        primaryAction: "copy_email",
        primaryLabel: "Copier",
        secondaryAction: "feedback_generic_message",
        secondaryLabel: "Générique",
        secondaryNote: "Message trop générique depuis le centre de validation."
      });
    }

    if (lead.outreach.followUp && lead.qualityDecision === "pass") {
      items.push({
        id: `${lead.id}-follow-up`,
        type: "follow_up",
        lead,
        label: "Relance",
        detail: "Relance à copier seulement après validation serveur.",
        primaryAction: "copy_follow_up",
        primaryLabel: "Copier",
        secondaryAction: "outcome_negative",
        secondaryLabel: "Bloquer",
        secondaryNote: "Outcome négatif : relance bloquée depuis le centre de validation.",
        danger: false
      });
    }
  }

  return items.sort((left, right) => approvalPriority(left.type) - approvalPriority(right.type));
}

function approvalPriority(type: ApprovalItemType): number {
  const priorities: Record<ApprovalItemType, number> = {
    qc_dnc: 0,
    lead: 1,
    email: 2,
    follow_up: 3,
    enrichment: 4,
    exploration: 5
  };
  return priorities[type];
}

function isDncOrOptOut(lead: ScoutLead): boolean {
  const reason = lead.rejectionReason?.toLowerCase() ?? "";
  return lead.personas.some((persona) => persona.doNotContact) || reason.includes("do-not-contact") || reason.includes("opt-out");
}

function approvalActionIcon(action: LeadActionType): ReactNode {
  if (action === "copy_email" || action === "copy_follow_up" || action === "feedback_generic_message" || action === "request_enrichment") {
    return <Clipboard size={15} />;
  }
  if (action === "rerun_qc") return <RefreshCw size={15} />;
  if (action === "add_do_not_contact") return <UserX size={15} />;
  if (action === "reject_lead" || action === "outcome_negative") return <X size={15} />;
  return <Check size={15} />;
}

function InsightBlock({ lead }: { lead: ScoutLead }) {
  const insights = lead.insights ?? deriveInsights(lead);
  return (
    <div className="insights-grid">
      <InsightColumn label="Observé" items={insights.observed.map((item) => item.text)} />
      <InsightColumn label="Inféré" items={insights.inferred} />
      <InsightColumn label="Incertain" items={insights.uncertain} />
    </div>
  );
}

function InsightColumn({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="insight-column">
      <strong>{label}</strong>
      {items.slice(0, 2).map((item) => (
        <p key={item}>{item}</p>
      ))}
    </div>
  );
}

function QueueRow({ lead }: { lead: ScoutLead }) {
  return (
    <article className="queue-row">
      <div>
        <div className="row-company">{lead.company}</div>
        <div className="row-sub">{lead.segment}</div>
      </div>
      <div className="row-score">{lead.score}</div>
      <div className="row-action">{lead.nextAction}</div>
    </article>
  );
}

function QualityBox({ lead }: { lead: ScoutLead }) {
  const blocked = lead.qualityDecision === "blocked";
  const failed = lead.qualityGates.filter((gate) => !gate.passed);
  return (
    <section className={`qc ${blocked ? "blocked" : ""}`}>
      <div className="qc-title">
        <ShieldCheck size={18} />
        QC : {blocked ? "Bloqué" : lead.qualityDecision === "pass" ? "Pass" : "À enrichir"}
      </div>
      <p>{failed[0]?.reason ?? "Les signaux, le message et la conformité passent les gates V1."}</p>
    </section>
  );
}

function uniqueLeads(leads: Array<ScoutLead | null>): ScoutLead[] {
  const seen = new Set<string>();
  return leads.flatMap((lead) => {
    if (!lead || seen.has(lead.id)) return [];
    seen.add(lead.id);
    return [lead];
  });
}

function approvalLabel(lead: ScoutLead): string {
  if (lead.qualityDecision === "blocked") return lead.rejectionReason ?? "Bloqué QC ou do-not-contact.";
  if (lead.qualityDecision === "needs_enrichment") return "À enrichir avant copie.";
  if (lead.mode === "exploration") return "Shortlist exploration, pas de message direct.";
  return "Prêt pour décision Romu, sans envoi automatique.";
}

function contactSummary(lead: ScoutLead): string {
  const persona = lead.personas[0];
  if (!persona) return "Aucun persona exploitable.";
  const email = persona.email
    ? `${persona.email} (${emailStatusLabel(persona.emailStatus)})`
    : `email ${emailStatusLabel(persona.emailStatus)}`;
  return `${persona.role} · ${email} · ${emailTypeLabel(persona.emailType)} · confiance ${persona.emailConfidence ?? "low"}`;
}

function emailStatusLabel(status: ScoutLead["personas"][number]["emailStatus"]): string {
  if (status === "usable") return "utilisable";
  if (status === "verify") return "à vérifier";
  return "non utilisable";
}

function emailTypeLabel(type: ScoutLead["personas"][number]["emailType"]): string {
  if (type === "public_named") return "nominatif public";
  if (type === "generic") return "générique";
  if (type === "probable_pattern") return "pattern probable";
  return "source inconnue";
}

function deriveInsights(lead: ScoutLead): StructuredInsights {
  return {
    observed: lead.observedSignals.map((signal, index) => ({
      text: signal,
      evidenceId: lead.evidence[index]?.id ?? lead.evidence[index]?.url ?? ""
    })),
    inferred: lead.painHypotheses,
    uncertain: lead.personas.some((persona) => persona.contactConfidence !== "confirmed" || persona.emailStatus !== "usable")
      ? ["Décideur, email et outils internes à confirmer."]
      : []
  };
}

function BriefBox({ snapshot }: { snapshot: ScoutSnapshot }) {
  return (
    <section>
      <h2>Brief agentique</h2>
      <div className="brief-list">
        <BriefGroup label="Fait" items={snapshot.brief.completed} />
        <BriefGroup label="Recommande" items={snapshot.brief.recommended} />
        {snapshot.brief.blocked.length ? <BriefGroup label="Bloqué" items={snapshot.brief.blocked} /> : null}
      </div>
    </section>
  );
}

function BriefGroup({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="brief-group">
      <strong>{label}</strong>
      {items.slice(0, 3).map((item) => (
        <p key={item}>{item}</p>
      ))}
    </div>
  );
}

function TaskBoard({ tasks }: { tasks: AgentTask[] }) {
  return (
    <section>
      <h2>Routines</h2>
      <div className="task-list">
        {tasks.slice(0, 6).map((task) => (
          <div className={`task-row ${task.status}`} key={task.id}>
            <div>
              <strong>{task.title}</strong>
              <p>{statusLabel(task.status)}</p>
            </div>
            <span>{taskTargetLabel(task)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RoutineActions() {
  return (
    <div className="routine-actions" aria-label="Lancer une routine BM Scout">
      <ScoutActionButton className="button" action="launch_core"><Play size={16} /> Core</ScoutActionButton>
      <ScoutActionButton className="button" action="launch_exploration"><Play size={16} /> Exploration</ScoutActionButton>
      <ScoutActionButton className="button" action="launch_daily_brief"><Play size={16} /> Daily Brief</ScoutActionButton>
      <ScoutActionButton className="button" action="launch_learning_review"><Play size={16} /> Learning</ScoutActionButton>
      <ScoutActionButton className="button" action="launch_dnc_check"><Play size={16} /> Contrôle DNC</ScoutActionButton>
      <ScoutActionButton className="button" action="launch_followup_review"><Play size={16} /> Relances</ScoutActionButton>
    </div>
  );
}

function decisionCount(snapshot: ScoutSnapshot) {
  return Number(Boolean(snapshot.primaryLead)) + snapshot.queue.length + snapshot.exploration.length;
}

function nextRoutineLabel(tasks: AgentTask[]) {
  const next = tasks.find((task) => task.status === "queued" || task.status === "running" || task.status === "blocked");
  if (!next) return "Aucune routine en attente.";
  return `${next.title} : ${statusLabel(next.status)}`;
}

function statusLabel(status: AgentTask["status"]) {
  const labels: Record<AgentTask["status"], string> = {
    queued: "En file",
    running: "En cours",
    blocked: "Bloqué",
    completed: "Terminé",
    failed: "Échec",
    cancelled: "Annulé"
  };
  return labels[status];
}

function taskTargetLabel(task: AgentTask) {
  if (task.type === "weekly_core_research") return String(task.payload.coreWeeklyTarget);
  if (task.type === "weekly_exploration_scan") return String(task.payload.explorationScanTarget);
  if (task.type === "daily_brief") return "brief";
  if (task.type === "learning_review") return "learn";
  return "gate";
}

function initials(company: string) {
  return company
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
