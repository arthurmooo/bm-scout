import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLocalEnvFiles, parseEnvLine } from "./runtime-env";

const touchedKeys = ["BM_SCOUT_TEST_KEY", "BM_SCOUT_EXISTING_KEY", "BM_SCOUT_QUOTED_KEY"];
let tempDirs: string[] = [];

afterEach(() => {
  for (const key of touchedKeys) delete process.env[key];
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("runtime env loader", () => {
  it("charge .env.local puis .env sans écraser l'environnement existant", () => {
    const dir = mkdtempSync(join(tmpdir(), "bm-scout-env-"));
    tempDirs.push(dir);
    process.env.BM_SCOUT_EXISTING_KEY = "runtime-value";
    writeFileSync(
      join(dir, ".env.local"),
      [
        "BM_SCOUT_TEST_KEY=local-value",
        "BM_SCOUT_EXISTING_KEY=file-value",
        "BM_SCOUT_QUOTED_KEY=\"quoted value\""
      ].join("\n")
    );
    writeFileSync(join(dir, ".env"), "BM_SCOUT_TEST_KEY=fallback-value\n");

    const result = loadLocalEnvFiles(dir);

    expect(result.files).toEqual([".env.local", ".env"]);
    expect(result.keys).toContain("BM_SCOUT_TEST_KEY");
    expect(process.env.BM_SCOUT_TEST_KEY).toBe("local-value");
    expect(process.env.BM_SCOUT_EXISTING_KEY).toBe("runtime-value");
    expect(process.env.BM_SCOUT_QUOTED_KEY).toBe("quoted value");
  });

  it("parse les lignes env usuelles sans exposer les valeurs", () => {
    expect(parseEnvLine("OPENAI_API_KEY=placeholder-key # local")).toEqual(["OPENAI_API_KEY", "placeholder-key"]);
    expect(parseEnvLine("BAD-KEY=value")).toBeNull();
    expect(parseEnvLine("# ignored")).toBeNull();
  });
});
