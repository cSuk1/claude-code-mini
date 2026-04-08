import type { ParsedArgs } from "./args.js";
import { printError } from "../ui/index.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { chmodSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export interface ApiConfig {
  apiBase?: string;
  apiKey: string;
  useOpenAI: boolean;
}

interface ConfigFile {
  api?: {
    provider?: "anthropic" | "openai";
    apiKey?: string;
    baseUrl?: string;
  };
  models?: Record<string, string>;
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  [key: string]: any;
}

export function loadConfigFile(): ConfigFile | null {
  const paths = [
    join(homedir(), ".ccmini", "settings.json"),
    join(process.cwd(), ".ccmini", "settings.json"),
  ];

  for (const filePath of paths) {
    if (!existsSync(filePath)) continue;
    try {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      // Ignore malformed config
    }
  }
  return null;
}

/**
 * Load a settings file from a specific path.
 * Returns null if file doesn't exist or is malformed.
 */
export function loadSettingsFile(filePath: string): ConfigFile | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Read settings JSON from a specific path, returning a partial merge of all valid files.
 * If no files exist, returns null.
 */
export function loadSettingsJson(filePath: string): any {
  return loadSettingsFile(filePath);
}

/**
 * Read the raw JSON object from a settings file (or empty object if not found).
 * This is the common pattern used across permissions.ts and commands.ts.
 */
export function readOrCreateSettings(filePath: string): any {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Write settings to a file, creating parent directories as needed.
 */
export function writeSettingsFile(filePath: string, data: any): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  // Restrict file permissions to owner-only (rw-------) to protect API keys
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // chmod may fail on some platforms (e.g. Windows), non-critical
  }
}

/** User-level settings path */
export function getUserSettingsPath(): string {
  return join(homedir(), ".ccmini", "settings.json");
}

/** Project-level settings path */
export function getProjectSettingsPath(): string {
  return join(process.cwd(), ".ccmini", "settings.json");
}

export function resolveApiConfig(args: ParsedArgs): ApiConfig {
  const { apiBase } = args;

  let resolvedApiBase = apiBase;
  let resolvedApiKey: string | undefined;
  let resolvedUseOpenAI = !!apiBase;

  const configFile = loadConfigFile();
  const configApi = configFile?.api;

  if (configApi?.provider) {
    resolvedUseOpenAI = configApi.provider === "openai";
    if (configApi.baseUrl) {
      resolvedApiBase = configApi.baseUrl;
    }
    if (configApi.apiKey) {
      resolvedApiKey = configApi.apiKey;
    }
  }

  if (apiBase && !resolvedApiKey) {
    printError(
      `API key required. Use --connect to configure your provider.`
    );
    process.exit(1);
  }

  if (!resolvedApiKey) {
    printError(
      `API not configured. Run 'claude-code-mini --connect' to set up.`
    );
    process.exit(1);
  }

  return {
    apiBase: resolvedApiBase,
    apiKey: resolvedApiKey,
    useOpenAI: resolvedUseOpenAI,
  };
}
