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
import type { AgentTask, ScoutLead, ScoutSnapshot, StructuredInsights } from "@/domain/types";
import { ScoutActionButton } from "./ScoutActionButton";

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
        <ScoutActionButton className="button" action="mark_message_used" leadId={lead.id}><Check size={17} /> Utilisé</ScoutActionButton>
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
      <details className="deep-card">
        <summary><FileText size={17} /> Fiche profonde</summary>
        <p>{lead.deepCard}</p>
        <InsightBlock lead={lead} />
      </details>
    </article>
  );
}

function ApprovalCenter({ snapshot }: { snapshot: ScoutSnapshot }) {
  const items = uniqueLeads([
    snapshot.primaryLead,
    ...snapshot.queue,
    ...snapshot.exploration,
    ...snapshot.rejected.filter((lead) => lead.qualityDecision === "blocked").slice(0, 2)
  ]).slice(0, 5);

  return (
    <section>
      <h2>À valider</h2>
      <div className="approval-list">
        {items.map((lead) => (
          <div className="approval-row" key={lead.id}>
            <div>
              <strong>{lead.company}</strong>
              <p>{approvalLabel(lead)}</p>
            </div>
            <div className="approval-actions">
              {lead.qualityDecision === "pass" ? (
                <ScoutActionButton className="button compact" action="validate_lead" leadId={lead.id}><Check size={15} /> OK</ScoutActionButton>
              ) : (
                <ScoutActionButton className="button compact" action="request_enrichment" leadId={lead.id}><Clipboard size={15} /> Enrichir</ScoutActionButton>
              )}
              <ScoutActionButton className="button compact danger" action="reject_lead" leadId={lead.id} reason="Rejet depuis le centre de validation."><X size={15} /> Non</ScoutActionButton>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
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
  return `${persona.role} · ${email} · confiance ${persona.emailConfidence ?? "low"}`;
}

function emailStatusLabel(status: ScoutLead["personas"][number]["emailStatus"]): string {
  if (status === "usable") return "utilisable";
  if (status === "verify") return "à vérifier";
  return "non utilisable";
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
