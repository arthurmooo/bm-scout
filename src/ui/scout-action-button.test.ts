import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const button = readFileSync(join(process.cwd(), "src", "ui", "ScoutActionButton.tsx"), "utf8");

describe("ScoutActionButton", () => {
  it("attend le verdict JSON serveur avant de copier", () => {
    expect(button).toContain("parseActionResponse(response)");
    expect(button).toContain("if (!result.ok)");
    expect(button.indexOf("if (!result.ok)")).toBeLessThan(button.indexOf("navigator.clipboard.writeText(copyText)"));
  });

  it("affiche un libellé d'erreur spécifique pour DNC, QC ou email", () => {
    expect(button).toContain("shortErrorLabel(message)");
    expect(button).toContain('includes("do-not-contact")');
    expect(button).toContain('includes("quality control")');
    expect(button).toContain('includes("email")');
  });
});
