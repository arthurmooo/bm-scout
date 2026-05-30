import type { ScoutLead } from "./types";

export const coreCandidates: ScoutLead[] = [
  {
    id: "core-cambon",
    company: "Cambon Partners",
    website: "https://www.cambonpartners.com",
    mode: "core",
    segment: "Conseil M&A",
    score: 89,
    verdict: "validate",
    qualityDecision: "pass",
    observedSignals: [
      "Banque d'affaires indépendante active en M&A, growth et LBO.",
      "Transactions publiques régulières, donc coordination multi-dossiers probable.",
      "Bureaux Paris/Londres, signal d'organisation structurée."
    ],
    painHypotheses: [
      "Le suivi deal-by-deal peut encore exiger rapprochements entre emails, fichiers, data room et reporting.",
      "Les relances acheteurs/NDA/Q&A sont des tâches grises crédibles sans toucher au jugement M&A."
    ],
    scoreJustification: "Très fort fit M&A, signaux publics concrets, douleur workflow plausible, risque faible si Romu reste sur une question prudente.",
    shortCard: "Compte Core BM prioritaire. Ouvrir sur le suivi deal-by-deal et vérifier une seule friction entre outils.",
    deepCard: "Cambon Partners correspond au coeur BM : équipe deal, opérations publiques, besoin probable de coordination. Ne pas affirmer leur stack. Angle recommandé : statuts acheteurs, relances, documents et reporting entre outils existants.",
    personas: [
      {
        role: "Partner M&A",
        reason: "Sponsor capable de qualifier la friction côté exécution deal.",
        contactConfidence: "role_only"
      },
      {
        role: "COO / Operations",
        reason: "Profil le plus proche des tâches grises transverses.",
        contactConfidence: "role_only"
      }
    ],
    evidence: [
      {
        label: "Site officiel",
        url: "https://www.cambonpartners.com/en/about-us",
        observedFact: "Cambon Partners se présente comme banque d'affaires indépendante avec bureaux à Paris et Londres.",
        reliability: "high"
      },
      {
        label: "Expertises",
        url: "https://www.cambonpartners.com/en/expertise",
        observedFact: "Le site cite Venture, Growth capital, LBO et M&A.",
        reliability: "high"
      },
      {
        label: "Implantations",
        url: "https://www.cambonpartners.com/en/about-us",
        observedFact: "Le site officiel présente une organisation avec bureaux à Paris et Londres.",
        reliability: "high"
      }
    ],
    outreach: {
      coldEmail: "Bonjour,\n\nJe suis Arthur de BM Automation. J'ai vu que Cambon Partners intervient sur des opérations M&A, Growth et LBO, avec une activité transactionnelle visible publiquement.\n\nHypothèse prudente : sur certains dossiers, le suivi des statuts, relances, documents et reporting repasse encore entre emails, fichiers et outils existants.\n\nEst-ce un sujet utile à vérifier sur un seul workflow deal-by-deal ? Si vous ne souhaitez pas être recontacté, dites-le simplement.",
      followUp: "Bonjour,\n\nJe me permets une relance courte. Mon point n'est pas de remplacer vos outils M&A, mais d'identifier une tâche manuelle précise entre emails, fichiers, data room ou reporting qui pourrait disparaître.\n\nEst-ce que cela mérite 15 minutes, ou vaut-il mieux que je n'insiste pas ?",
      linkedin: "Bonjour, j'ai vu l'activité M&A/Growth de Cambon Partners. Je cherche à comprendre si certains suivis deal-by-deal repassent encore entre emails, fichiers et reporting. Sujet très ciblé, sans remplacement d'outil. Ouvert à un échange court ?"
    },
    qualityGates: [
      { code: "icp", passed: true, reason: "M&A coeur BM." },
      { code: "signal", passed: true, reason: "Deux sources officielles." },
      { code: "specificity", passed: true, reason: "Angle deal-by-deal propre au segment." },
      { code: "compliance", passed: true, reason: "Hypothèse prudente et opt-out inclus." }
    ],
    nextAction: "Valider l'angle puis choisir un sponsor M&A ou operations."
  },
  {
    id: "core-eight-advisory",
    company: "Eight Advisory",
    website: "https://www.8advisory.com",
    mode: "core",
    segment: "Transaction Services",
    score: 84,
    verdict: "enrich",
    qualityDecision: "needs_enrichment",
    observedSignals: [
      "Transaction Services et Restructuring affichés publiquement.",
      "Missions documentaires et multi-intervenants probables."
    ],
    painHypotheses: [
      "Les checklists, demandes clients et versions de documents peuvent créer une charge entre outils.",
      "Le meilleur angle est mission TS/restructuring, pas automatisation générale."
    ],
    scoreJustification: "Fit très fort, mais le contact cible doit être précisé avant tout message.",
    shortCard: "Très bon compte Core. Bloquer l'envoi tant qu'un rôle/persona précis n'est pas validé.",
    deepCard: "Le compte est commercialement pertinent mais ne doit pas recevoir un message générique. Trouver un sponsor TS/restructuring ou operations avant cold email.",
    personas: [
      { role: "Partner Transaction Services", reason: "Responsable de missions à forte coordination documentaire.", contactConfidence: "role_only" },
      { role: "Responsable méthodes / operations", reason: "Propriétaire probable des standards et outils internes.", contactConfidence: "uncertain" }
    ],
    evidence: [
      {
        label: "Transaction Services",
        url: "https://www.8advisory.com/services/transaction-services/",
        observedFact: "Eight Advisory présente publiquement une offre Transaction Services.",
        reliability: "high"
      },
      {
        label: "Restructuring",
        url: "https://www.8advisory.com/services/restructuring/",
        observedFact: "Le restructuring implique des missions documentaires, délais et multiples parties prenantes.",
        reliability: "medium"
      }
    ],
    outreach: {
      coldEmail: "Brouillon bloqué : contact cible à confirmer avant message.",
      followUp: "Brouillon bloqué : aucun suivi tant qu'un contact n'est pas validé.",
      linkedin: "Brouillon bloqué : rôle cible à confirmer."
    },
    qualityGates: [
      { code: "icp", passed: true, reason: "Deal advisory coeur BM." },
      { code: "signal", passed: true, reason: "Sources métiers fortes." },
      { code: "contact", passed: false, reason: "Pas de personne confirmée." },
      { code: "compliance", passed: true, reason: "Aucune action externe." }
    ],
    nextAction: "Trouver un contact TS/restructuring avant rédaction."
  },
  {
    id: "core-in-extenso",
    company: "In Extenso",
    website: "https://www.inextenso.fr",
    mode: "core",
    segment: "Expertise comptable",
    score: 72,
    verdict: "enrich",
    qualityDecision: "needs_enrichment",
    observedSignals: [
      "Réseau structuré d'expertise comptable et conseil.",
      "Missions de suivi client, documents et obligations récurrentes."
    ],
    painHypotheses: [
      "Les relances de pièces et suivis de dossiers peuvent sortir des outils métier vers emails/tableurs."
    ],
    scoreJustification: "Fit BM crédible, mais moins prioritaire que M&A et nécessite un angle cabinet précis.",
    shortCard: "Compte secondaire à enrichir. Chercher un cas relance pièces client avant outreach.",
    deepCard: "Pertinent pour BM, mais risque de dilution hors wedge M&A. À traiter uniquement si Romu veut ouvrir un segment comptabilité structuré.",
    personas: [
      { role: "Associé expertise comptable", reason: "Peut qualifier les irritants de portefeuille client.", contactConfidence: "role_only" }
    ],
    evidence: [
      {
        label: "Site officiel",
        url: "https://www.inextenso.fr/",
        observedFact: "In Extenso se présente comme réseau d'expertise comptable et de conseil aux dirigeants.",
        reliability: "high"
      },
      {
        label: "Services dirigeants",
        url: "https://www.inextenso.fr/",
        observedFact: "L'offre publique s'adresse aux dirigeants avec des missions récurrentes de conseil et suivi.",
        reliability: "medium"
      }
    ],
    outreach: {
      coldEmail: "Brouillon bloqué : segment secondaire à cadrer avant contact.",
      followUp: "Brouillon bloqué.",
      linkedin: "Brouillon bloqué."
    },
    qualityGates: [
      { code: "icp", passed: true, reason: "Finance ops secondaire." },
      { code: "signal", passed: true, reason: "Signal métier mais général." },
      { code: "specificity", passed: false, reason: "Besoin d'un workflow précis." }
    ],
    nextAction: "Enrichir ou mettre en watch selon priorité M&A."
  }
];

export const explorationCandidates: ScoutLead[] = [
  {
    id: "exploration-dalloz",
    company: "Lefebvre Dalloz Compétences",
    website: "https://formation.lefebvre-dalloz.fr",
    mode: "exploration",
    segment: "Formation B2B",
    score: 78,
    verdict: "watch",
    qualityDecision: "pass",
    observedSignals: [
      "Catalogue public de formations professionnelles.",
      "Activité structurée autour de sessions, inscriptions et documents."
    ],
    painHypotheses: [
      "Les inscriptions, convocations, attestations et relances B2B peuvent créer une charge entre LMS, CRM, email et documents."
    ],
    scoreJustification: "Bonne opportunité exploration, mais la règle V1 impose shortlist et décision verticale avant message.",
    shortCard: "Exploration actionnable : verticale formation B2B à creuser, pas de message immédiat.",
    deepCard: "Le segment montre un pattern BM crédible : documents, relances, sessions, clients B2B. À comparer à 3 autres organismes avant promotion en Core.",
    personas: [
      { role: "Responsable opérations formation", reason: "Proche des workflows inscriptions/documents.", contactConfidence: "role_only" }
    ],
    evidence: [
      {
        label: "Catalogue formations",
        url: "https://formation.lefebvre-dalloz.fr/formations",
        observedFact: "Le catalogue public montre des programmes, sessions et inscriptions.",
        reliability: "medium"
      },
      {
        label: "Catalogue formations",
        url: "https://formation.lefebvre-dalloz.fr/formations",
        observedFact: "Les pages de formation impliquent inscriptions, convocations et documents de session.",
        reliability: "medium"
      }
    ],
    outreach: {
      coldEmail: "Brouillon bloqué : Exploration doit d'abord être promue ou écartée.",
      followUp: "Brouillon bloqué.",
      linkedin: "Brouillon bloqué."
    },
    qualityGates: [
      { code: "exploration_scope", passed: true, reason: "Process documents/relances plausible." },
      { code: "no_direct_outreach", passed: true, reason: "Pas de message par défaut en Exploration." }
    ],
    nextAction: "Décider si la verticale Formation B2B mérite 5 comptes supplémentaires."
  },
  {
    id: "exploration-pagegroup",
    company: "PageGroup France",
    website: "https://www.pagepersonnel.fr",
    mode: "exploration",
    segment: "Recrutement",
    score: 74,
    verdict: "watch",
    qualityDecision: "pass",
    observedSignals: [
      "Activité recrutement B2B avec multiples offres et suivis candidats/clients.",
      "Coordination probable entre CRM, emails, documents et reporting client."
    ],
    painHypotheses: [
      "Les comptes rendus clients, relances candidats et reporting peuvent créer des tâches grises."
    ],
    scoreJustification: "Exploration intéressante mais à cadrer pour éviter le volume bruité.",
    shortCard: "Shortlist exploration. À tester seulement si l'angle reporting client est sourcé.",
    deepCard: "Potentiel process-heavy, mais moins proche que M&A. Ne pas diluer BM vers agence recrutement générique.",
    personas: [
      { role: "Direction operations recrutement", reason: "Responsable probable du suivi process.", contactConfidence: "uncertain" }
    ],
    evidence: [
      {
        label: "Site officiel",
        url: "https://www.pagepersonnel.fr",
        observedFact: "PageGroup publie une activité de recrutement structurée avec offres et services B2B.",
        reliability: "medium"
      },
      {
        label: "Offres publiques",
        url: "https://www.pagepersonnel.fr/jobs",
        observedFact: "Les offres publiques suggèrent un flux continu de candidats, clients et suivis d'avancement.",
        reliability: "medium"
      }
    ],
    outreach: {
      coldEmail: "Brouillon bloqué : Exploration non promue.",
      followUp: "Brouillon bloqué.",
      linkedin: "Brouillon bloqué."
    },
    qualityGates: [
      { code: "exploration_scope", passed: true, reason: "Coordination process plausible." },
      { code: "dilution", passed: true, reason: "Maintenir l'angle reporting client." }
    ],
    nextAction: "Comparer au segment formation avant promotion."
  }
];

export const weakCandidates: ScoutLead[] = [
  {
    id: "weak-studio-yoga",
    company: "Studio Yoga Canal",
    website: "",
    mode: "exploration",
    segment: "Commerce local",
    score: 18,
    verdict: "reject",
    qualityDecision: "blocked",
    observedSignals: [],
    painHypotheses: ["Hypothèse inventée : ils ont sûrement besoin d'IA."],
    scoreJustification: "Rejet : trop petit, aucun signal process B2B, douleur inventée.",
    shortCard: "No-go. Aucun signal concret BM.",
    deepCard: "Cas volontairement faible pour QC négatif.",
    personas: [{ role: "Gérant", reason: "Contact incertain et non pertinent BM.", contactConfidence: "uncertain" }],
    evidence: [],
    outreach: {
      coldEmail: "Bonjour, nous aidons les entreprises comme la vôtre avec l'IA.",
      followUp: "Je relance mon message sur l'IA.",
      linkedin: "Envie d'automatiser votre business avec l'IA ?"
    },
    qualityGates: [
      { code: "icp", passed: false, reason: "Hors ICP." },
      { code: "signal", passed: false, reason: "Aucun signal observé." },
      { code: "generic_message", passed: false, reason: "Message réutilisable partout." }
    ],
    nextAction: "Rejeter.",
    rejectionReason: "Entreprise trop petite et signal inventé."
  }
];
