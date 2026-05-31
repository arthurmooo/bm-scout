import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dashboard = readFileSync(join(process.cwd(), "src", "ui", "ScoutDashboard.tsx"), "utf8");

describe("ScoutDashboard feedback actions", () => {
  it("expose les raisons Romu demandées sans multiplier les enums métier", () => {
    for (const label of [
      "Très bon",
      "Bon secteur",
      "Bon contact",
      "Trop petit",
      "Mauvais secteur",
      "Douleur faible",
      "Peu sourcé",
      "Déjà contacté",
      "À surveiller",
      "À exclure"
    ]) {
      expect(dashboard).toContain(`label: "${label}"`);
    }
  });

  it("expose le feedback message exploitable par la mémoire", () => {
    for (const note of [
      "Message utilisable tel quel",
      "Très bon angle",
      "Message à raccourcir",
      "Message trop générique",
      "Message mauvais angle",
      "Message trop IA",
      "Message trop commercial",
      "Message pas assez direct"
    ]) {
      expect(dashboard).toContain(note);
    }
  });

  it("structure le centre de validation par décisions métier", () => {
    for (const marker of [
      'type: "lead"',
      'type: "email"',
      'type: "follow_up"',
      'type: "exploration"',
      'type: "enrichment"',
      'type: "qc_dnc"',
      "DNC / opt-out",
      "Fiche bloquée",
      "Shortlist exploration",
      "Brouillon à copier seulement si le serveur confirme QC, email et DNC",
      "Relance à copier seulement après validation serveur"
    ]) {
      expect(dashboard).toContain(marker);
    }
  });
});
