from __future__ import annotations

from datetime import UTC, datetime

from .schemas import (
    Evidence,
    FeedbackEvent,
    LearningLesson,
    MissionOutput,
    OutreachPack,
    Persona,
    QualityGate,
    ScoutLead,
    ScoutMode,
)


def seed_feedbacks() -> list[FeedbackEvent]:
    now = datetime.now(UTC).isoformat()
    return [
        FeedbackEvent(id="fb-good-lead", lead_id="core-cambon", kind="good_lead", note="Très bon lead M&A.", created_at=now),
        FeedbackEvent(id="fb-bad-lead", lead_id="weak-studio-yoga", kind="bad_lead", note="Hors ICP.", created_at=now),
        FeedbackEvent(id="fb-generic", lead_id="weak-studio-yoga", kind="generic_message", note="Message générique.", created_at=now),
        FeedbackEvent(id="fb-angle", lead_id="core-cambon", kind="good_angle", note="Angle deal-by-deal utile.", created_at=now),
        FeedbackEvent(id="fb-outcome", lead_id="core-cambon", kind="positive_outcome", note="Réponse positive simulée.", created_at=now),
        FeedbackEvent(id="fb-dnc", lead_id="core-eight-advisory", kind="do_not_contact", note="Contact à bloquer.", created_at=now),
    ]


def candidate_leads(mode: ScoutMode, include_weak: bool = False) -> list[ScoutLead]:
    base = core_candidates() if mode == "core" else exploration_candidates()
    return [*base, *weak_candidates()] if include_weak else base


def core_candidates() -> list[ScoutLead]:
    return [
        ScoutLead(
            id="core-cambon",
            company="Cambon Partners",
            website="https://www.cambonpartners.com",
            mode="core",
            segment="Conseil M&A",
            score=89,
            verdict="validate",
            quality_decision="pass",
            observed_signals=[
                "Banque d'affaires indépendante active en M&A, growth et LBO.",
                "Transactions publiques régulières, donc coordination multi-dossiers probable.",
            ],
            pain_hypotheses=[
                "Le suivi deal-by-deal peut exiger des rapprochements entre emails, fichiers, data room et reporting.",
                "Les relances acheteurs, NDA et Q&A sont des tâches grises crédibles sans toucher au jugement M&A.",
            ],
            score_justification="Très fort fit M&A, signaux publics concrets, douleur workflow plausible.",
            short_card="Compte Core prioritaire. Vérifier une friction entre outils sur le suivi deal-by-deal.",
            deep_card="Angle recommandé : statuts acheteurs, relances, documents et reporting entre outils existants. Ne pas affirmer leur stack.",
            personas=[
                Persona(role="Partner M&A", reason="Sponsor capable de qualifier la friction côté exécution deal."),
                Persona(role="COO / Operations", reason="Profil proche des tâches grises transverses."),
            ],
            evidence=[
                Evidence(label="Site officiel", url="https://www.cambonpartners.com/en/about-us", observed_fact="Cambon Partners se présente comme banque d'affaires indépendante."),
                Evidence(label="Expertises", url="https://www.cambonpartners.com/en/expertise", observed_fact="Le site cite Venture, Growth capital, LBO et M&A."),
            ],
            outreach=OutreachPack(
                cold_email="Bonjour,\n\nJe suis Arthur de BM Automation. J'ai vu que Cambon Partners intervient sur des opérations M&A, Growth et LBO.\n\nHypothèse prudente : sur certains dossiers, le suivi des statuts, relances, documents et reporting repasse encore entre emails, fichiers et outils existants.\n\nEst-ce un sujet utile à vérifier sur un seul workflow deal-by-deal ? Si vous ne souhaitez pas être recontacté, dites-le simplement.",
                follow_up="Bonjour,\n\nJe me permets une relance courte. Mon point n'est pas de remplacer vos outils M&A, mais d'identifier une tâche manuelle précise entre emails, fichiers, data room ou reporting qui pourrait disparaître.\n\nEst-ce que cela mérite 15 minutes, ou vaut-il mieux que je n'insiste pas ?",
                linkedin="Bonjour, j'ai vu l'activité M&A/Growth de Cambon Partners. Je cherche à comprendre si certains suivis deal-by-deal repassent encore entre emails, fichiers et reporting. Ouvert à un échange court ?",
            ),
            quality_gates=[
                QualityGate(code="icp", passed=True, reason="M&A coeur BM."),
                QualityGate(code="signal", passed=True, reason="Deux sources officielles."),
                QualityGate(code="compliance", passed=True, reason="Hypothèse prudente et opt-out inclus."),
            ],
            next_action="Valider l'angle puis choisir un sponsor M&A ou operations.",
        ),
        ScoutLead(
            id="core-eight-advisory",
            company="Eight Advisory",
            website="https://www.8advisory.com",
            mode="core",
            segment="Transaction Services",
            score=84,
            verdict="enrich",
            quality_decision="needs_enrichment",
            observed_signals=["Transaction Services et Restructuring affichés publiquement."],
            pain_hypotheses=["Les checklists, demandes clients et versions de documents peuvent créer une charge entre outils."],
            score_justification="Fit fort, mais le contact cible doit être précisé avant tout message.",
            short_card="Très bon compte Core. Bloquer l'envoi tant qu'un rôle précis n'est pas validé.",
            deep_card="Trouver un sponsor TS/restructuring ou operations avant cold email.",
            personas=[Persona(role="Partner Transaction Services", reason="Responsable de missions à forte coordination documentaire.")],
            evidence=[Evidence(label="Transaction Services", url="https://www.8advisory.com/services/transaction-services/", observed_fact="Eight Advisory présente une offre Transaction Services.")],
            outreach=OutreachPack(cold_email="Brouillon bloqué : contact cible à confirmer avant message.", follow_up="Brouillon bloqué.", linkedin="Brouillon bloqué."),
            quality_gates=[QualityGate(code="contact", passed=False, reason="Pas de personne confirmée.")],
            next_action="Trouver un contact TS/restructuring avant rédaction.",
        ),
    ]


def exploration_candidates() -> list[ScoutLead]:
    return [
        ScoutLead(
            id="exploration-dalloz",
            company="Lefebvre Dalloz Compétences",
            website="https://formation.lefebvre-dalloz.fr",
            mode="exploration",
            segment="Formation B2B",
            score=78,
            verdict="watch",
            quality_decision="pass",
            observed_signals=["Catalogue public de formations professionnelles.", "Activité structurée autour de sessions, inscriptions et documents."],
            pain_hypotheses=["Les inscriptions, convocations, attestations et relances B2B peuvent créer une charge entre LMS, CRM, email et documents."],
            score_justification="Bonne opportunité exploration, mais shortlist seulement avant promotion.",
            short_card="Exploration actionnable : verticale formation B2B à creuser, pas de message immédiat.",
            deep_card="Pattern BM crédible : documents, relances, sessions, clients B2B. À comparer avant promotion Core.",
            personas=[Persona(role="Responsable opérations formation", reason="Proche des workflows inscriptions/documents.")],
            evidence=[Evidence(label="Catalogue formations", url="https://formation.lefebvre-dalloz.fr/formations", observed_fact="Le catalogue public montre des programmes et inscriptions.")],
            outreach=OutreachPack(cold_email="Brouillon bloqué : Exploration doit d'abord être promue ou écartée.", follow_up="Brouillon bloqué.", linkedin="Brouillon bloqué."),
            quality_gates=[QualityGate(code="no_direct_outreach", passed=True, reason="Pas de message direct en Exploration.")],
            next_action="Décider si la verticale Formation B2B mérite 5 comptes supplémentaires.",
        )
    ]


def weak_candidates() -> list[ScoutLead]:
    return [
        ScoutLead(
            id="weak-studio-yoga",
            company="Studio Yoga Canal",
            mode="exploration",
            segment="Commerce local",
            score=18,
            verdict="reject",
            quality_decision="blocked",
            observed_signals=[],
            pain_hypotheses=["Hypothèse inventée : ils ont sûrement besoin d'IA."],
            score_justification="Rejet : trop petit, aucun signal process B2B, douleur inventée.",
            short_card="No-go. Aucun signal concret BM.",
            deep_card="Cas volontairement faible pour QC négatif.",
            personas=[Persona(role="Gérant", reason="Contact incertain et non pertinent BM.", contact_confidence="uncertain")],
            evidence=[],
            outreach=OutreachPack(cold_email="Bonjour, nous aidons les entreprises comme la vôtre avec l'IA.", follow_up="Je relance mon message sur l'IA.", linkedin="Envie d'automatiser votre business avec l'IA ?"),
            quality_gates=[
                QualityGate(code="icp", passed=False, reason="Hors ICP."),
                QualityGate(code="signal", passed=False, reason="Aucun signal observé."),
                QualityGate(code="generic_message", passed=False, reason="Message réutilisable partout."),
            ],
            next_action="Rejeter.",
            rejection_reason="Entreprise trop petite et signal inventé.",
        )
    ]


def learning_lessons(feedbacks: list[FeedbackEvent], leads: list[ScoutLead]) -> list[LearningLesson]:
    do_not_contact = any(feedback.kind == "do_not_contact" for feedback in feedbacks)
    generic = any(feedback.kind == "generic_message" for feedback in feedbacks)
    core_ready = sum(1 for lead in leads if lead.mode == "core" and lead.quality_decision in {"pass", "needs_enrichment"})
    return [
        LearningLesson(id="lesson-core-first", lesson=f"Les comptes Core avec signaux deal/document restent les plus exploitables ({core_ready} prêts ou presque prêts).", recommendation="Limiter la semaine suivante aux comptes M&A/finance ops avec deux sources minimum.", source="runs + feedback Romu", confidence=0.86),
        LearningLesson(id="lesson-angle", lesson="Les angles centrés sur une tâche entre outils sont meilleurs que les messages IA.", recommendation="Commencer par un fait public puis une hypothèse prudente de tâche grise.", source="feedback message", confidence=0.82),
        LearningLesson(id="lesson-qc", lesson="Le QC doit bloquer les formulations IA/génériques avant affichage." if generic else "Aucun message générique détecté.", recommendation="Conserver le gate anti-générique bloquant avant toute copie.", source="quality control", confidence=0.9),
        LearningLesson(id="lesson-optout", lesson="Un contact marqué do-not-contact bloque toute relance." if do_not_contact else "Aucun opt-out simulé.", recommendation="Faire passer le statut do-not-contact avant les recommandations de relance.", source="feedback/outcomes", confidence=0.95),
    ]


def offline_output(mode: ScoutMode, include_weak: bool = False) -> MissionOutput:
    feedbacks = seed_feedbacks()
    evaluated = candidate_leads(mode, include_weak=include_weak)
    leads = [lead for lead in evaluated if lead.quality_decision != "blocked" and lead.verdict != "reject"]
    rejected = [lead for lead in evaluated if lead.quality_decision == "blocked" or lead.verdict == "reject"]
    return MissionOutput(
        run_id=f"offline-{mode}-{int(datetime.now(UTC).timestamp())}",
        mode=mode,
        trace_id=f"trace_bm_scout_{mode}_offline",
        scanned_count=6 if mode == "core" else 12,
        kept_count=len(leads),
        rejected_count=len(rejected),
        leads=leads,
        rejected=rejected,
        lessons=learning_lessons(feedbacks, evaluated),
        final_decision="not_ready",
        qualitative_report="Run offline utile pour harnais demo, insuffisant pour readiness produit.",
    )
