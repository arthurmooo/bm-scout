import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { classifyOpenAiPreflightFailure, type OpenAiPreflightArtifact } from "../src/server/openai-preflight";
import { loadLocalEnvFiles } from "../src/server/runtime-env";

const execFileAsync = promisify(execFile);
loadLocalEnvFiles();

const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const baseArtifact = {
  generated_at: new Date().toISOString(),
  code_revision: await resolveCurrentCodeRevision(),
  has_openai_env: Boolean(process.env.OPENAI_API_KEY),
  model
};

if (!process.env.OPENAI_API_KEY) {
  await exitWithArtifact(
    {
      ...baseArtifact,
      status: "fail",
      source: "missing_env",
      blockers: ["OPENAI_API_KEY absent : runs Agents SDK réels impossibles."]
    },
    1
  );
}

try {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), openAiPreflightTimeoutMs());
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: controller.signal,
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: "BM Scout readiness preflight. Réponds seulement OK.",
      max_output_tokens: 16,
      store: false
    })
  });
  clearTimeout(timeout);

  if (response.ok) {
    await exitWithArtifact(
      {
        ...baseArtifact,
        status: "pass",
        source: "openai_responses",
        http_status: response.status,
        blockers: []
      },
      0
    );
  }

  const errorPayload = await safeErrorPayload(response);
  const blocker = classifyOpenAiPreflightFailure({
    httpStatus: response.status,
    errorType: errorPayload.type,
    errorCode: errorPayload.code,
    message: errorPayload.message
  });
  await exitWithArtifact(
    {
      ...baseArtifact,
      status: "fail",
      source: "openai_responses",
      http_status: response.status,
      error_type: errorPayload.type,
      error_code: errorPayload.code,
      blockers: [blocker]
    },
    1
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await exitWithArtifact(
    {
      ...baseArtifact,
      status: "fail",
      source: "network_error",
      blockers: [
        classifyOpenAiPreflightFailure({
          message
        })
      ]
    },
    1
  );
}

async function safeErrorPayload(response: Response): Promise<{ type?: string; code?: string; message?: string }> {
  try {
    const value = (await response.json()) as unknown;
    if (!isRecord(value) || !isRecord(value.error)) return {};
    return {
      type: typeof value.error.type === "string" ? value.error.type : undefined,
      code: typeof value.error.code === "string" ? value.error.code : undefined,
      message: typeof value.error.message === "string" ? value.error.message : undefined
    };
  } catch {
    return {};
  }
}

async function exitWithArtifact(artifact: OpenAiPreflightArtifact, code: number): Promise<never> {
  const output = JSON.stringify(artifact, null, 2);
  const artifactsDir = join(process.cwd(), "artifacts", "openai-runtime");
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(join(artifactsDir, "latest-preflight.json"), `${output}\n`, "utf8");
  if (code === 0) console.log(output);
  else console.error(output);
  process.exit(code);
}

function openAiPreflightTimeoutMs(): number {
  const value = Number(process.env.OPENAI_PREFLIGHT_TIMEOUT_MS ?? 15000);
  return Number.isFinite(value) && value >= 3000 ? value : 15000;
}

async function resolveCurrentCodeRevision(): Promise<string> {
  const configured = process.env.BM_SCOUT_CODE_REVISION ?? process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA;
  if (configured?.trim()) return configured.trim();
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      timeout: 2000
    });
    const revision = stdout.trim();
    if (!revision) return "unknown";
    const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
      timeout: 2000
    });
    return status.trim() ? `${revision}-dirty` : revision;
  } catch {
    return "unknown";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
