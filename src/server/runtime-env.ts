import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface LoadedEnvFiles {
  files: string[];
  keys: string[];
}

const DEFAULT_ENV_FILES = [".env.local", ".env"];

export function loadLocalEnvFiles(cwd = process.cwd(), files = DEFAULT_ENV_FILES): LoadedEnvFiles {
  const loadedFiles: string[] = [];
  const loadedKeys: string[] = [];

  for (const file of files) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    loadedFiles.push(file);
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] !== undefined) continue;
      process.env[key] = value;
      loadedKeys.push(key);
    }
  }

  return { files: loadedFiles, keys: loadedKeys };
}

export function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const index = trimmed.indexOf("=");
  if (index <= 0) return null;
  const key = trimmed.slice(0, index).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  const rawValue = trimmed.slice(index + 1).trim();
  return [key, unquoteEnvValue(rawValue)];
}

function unquoteEnvValue(value: string): string {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  const commentIndex = value.search(/\s#/);
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim();
}
