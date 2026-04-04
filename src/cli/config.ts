import type { ParsedArgs } from "./args.js";
import { printError } from "../ui/index.js";

export interface ApiConfig {
  apiBase?: string;
  apiKey: string;
  useOpenAI: boolean;
}

export function resolveApiConfig(args: ParsedArgs): ApiConfig {
  const { apiBase } = args;

  let resolvedApiBase = apiBase;
  let resolvedApiKey: string | undefined;
  let resolvedUseOpenAI = !!apiBase;

  // Check OPENAI env vars first (if OPENAI_BASE_URL is set, use OpenAI format)
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL) {
    resolvedApiKey = process.env.OPENAI_API_KEY;
    resolvedApiBase = resolvedApiBase || process.env.OPENAI_BASE_URL;
    resolvedUseOpenAI = true;
  } else if (process.env.ANTHROPIC_API_KEY) {
    resolvedApiKey = process.env.ANTHROPIC_API_KEY;
    resolvedApiBase = resolvedApiBase || process.env.ANTHROPIC_BASE_URL;
    resolvedUseOpenAI = false;
  } else if (process.env.OPENAI_API_KEY) {
    resolvedApiKey = process.env.OPENAI_API_KEY;
    resolvedApiBase = resolvedApiBase || process.env.OPENAI_BASE_URL;
    resolvedUseOpenAI = true;
  }

  // --api-base without env key: check if any key is available
  if (!resolvedApiKey && apiBase) {
    resolvedApiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
    resolvedUseOpenAI = true;
  }

  if (!resolvedApiKey) {
    printError(
      `API key is required.\n` +
        `  Set ANTHROPIC_API_KEY (+ optional ANTHROPIC_BASE_URL) for Anthropic format,\n` +
        `  or OPENAI_API_KEY + OPENAI_BASE_URL for OpenAI-compatible format.`
    );
    process.exit(1);
  }

  return {
    apiBase: resolvedApiBase,
    apiKey: resolvedApiKey,
    useOpenAI: resolvedUseOpenAI,
  };
}
