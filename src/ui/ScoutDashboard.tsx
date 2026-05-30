"use client";

import { Check, CircleDot, Clipboard, Compass, FileText, GraduationCap, Search, ShieldCheck, X } from "lucide-react";
import type { ScoutLead, ScoutSnapshot } from "@/domain/types";

const navItems = [
  { label: "Aujourd'hui", icon: CircleDot, active: true },
  { label: "Core", icon: Compass },
  { label: "Explorer", icon: Search },
  { label: "Learning", icon: GraduationCap },
  { label: "Qualité", icon: ShieldCheck }
];

export function ScoutDashboard({ snapshot }: { snapshot: ScoutSnapshot }) {
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
          <div className="topbar-status">
            <span className="status-dot" />
            {decisionCount(snapshot)} décisions attendent Romu
          </div>
        </header>
        <section className="content">
          <div className="decision-area">
            <div className="section-title">
              <div>
                <h2>Prochaine meilleure action</h2>
                <p className="quiet">Une décision claire, puis seulement les preuves utiles.</p>
              </div>
            </div>
            {primary ? <PrimaryLead lead={primary} /> : <div className="primary-card">Aucun lead prêt à arbitrer.</div>}
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
            <section>
              <h2>Pourquoi maintenant</h2>
              <div className="proof-list">
                {(primary?.evidence ?? []).slice(0, 3).map((proof) => (
                  <div className="proof" key={proof.url}>
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
          <span>Core BM terminé · Exploration filtrée · Learning mis à jour</span>
          <span>Prochaine routine : lundi 08:15</span>
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
      </div>
      <div className="action-row">
        <button className="button primary" type="button"><Check size={17} /> Valider</button>
        <button className="button" type="button"><Clipboard size={17} /> Enrichir</button>
        <button className="button danger" type="button"><X size={17} /> Rejeter</button>
        <button className="button" type="button"><FileText size={17} /> Fiche profonde</button>
      </div>
    </article>
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

function decisionCount(snapshot: ScoutSnapshot) {
  return Number(Boolean(snapshot.primaryLead)) + snapshot.queue.length + snapshot.exploration.length;
}

function initials(company: string) {
  return company
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
