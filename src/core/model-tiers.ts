// Model tier system — three-tier model hierarchy for different task complexities.
//
// Priority chain (high → low):
//   1. Runtime switch  — /model pro <name> or agent.setTierModel()
//   2. Environment vars — MINI_CLAUDE_MODEL_PRO / _LITE / _MINI
//   3. Config file      — .ccmini/settings.json  { "models": { "pro": "...", ... } }
//   4. Built-in defaults
//
// Sub-agent task routing maps agent types to tiers automatically.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { BUILTIN_AGENT_TYPES, type BuiltinAgentType } from "../extensions/subagent.js";

// ─── Types ──────────────────────────────────────────────────

export type ModelTier = "pro" | "lite" | "mini";

export interface ModelTierConfig {
  tier: ModelTier;
  /** Resolved model name (after priority chain) */
  model: string;
  description: string;
  /** Where the current value comes from */
  source: "default" | "config" | "env" | "runtime";
}

// ─── Built-in defaults ─────────────────────────────────────

const DEFAULT_MODELS: Record<ModelTier, string> = {
  pro:  "glm-5",
  lite: "minimax-m2.5",
  mini: "kimi-k2.5",
};

const TIER_DESCRIPTIONS: Record<ModelTier, string> = {
  pro:  "Primary model — complex reasoning, main conversation",
  lite: "Lightweight — sub-agents, exploration, planning",
  mini: "Minimal — quick queries, simple checks, compact",
};

// ─── Agent type → Tier mapping ──────────────────────────────
// Single source of truth for routing sub-agent types to model tiers.

const AGENT_TYPE_TIER_MAP: Record<string, ModelTier> = {
  [BUILTIN_AGENT_TYPES.EXPLORE]: "lite",
  [BUILTIN_AGENT_TYPES.PLAN]:    "lite",
  [BUILTIN_AGENT_TYPES.GENERAL]: "pro",
  [BUILTIN_AGENT_TYPES.COMPACT]: "mini",
};

// ─── Internal state ─────────────────────────────────────────

interface TierState {
  model: string;
  source: "default" | "config" | "env" | "runtime";
}

const tiers: Record<ModelTier, TierState> = {
  pro:  { model: DEFAULT_MODELS.pro,  source: "default" },
  lite: { model: DEFAULT_MODELS.lite, source: "default" },
  mini: { model: DEFAULT_MODELS.mini, source: "default" },
};

let initialized = false;

// ─── Initialization (call once at startup) ──────────────────

/**
 * Load tier configuration from config files and env vars.
 * Call once during CLI startup, before creating the first Agent.
 */
export function initModelTiers(): void {
  if (initialized) return;
  initialized = true;

  // Layer 1: config file (lowest priority override)
  loadFromConfigFiles();

  // Layer 2: environment variables (higher priority)
  loadFromEnv();
}

function loadFromConfigFiles(): void {
  const paths = [
    join(homedir(), ".ccmini", "settings.json"),
    join(process.cwd(), ".ccmini", "settings.json"),
  ];

  for (const filePath of paths) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      const models = raw?.models;
      if (!models || typeof models !== "object") continue;
      for (const tier of ["pro", "lite", "mini"] as ModelTier[]) {
        if (typeof models[tier] === "string" && models[tier]) {
          tiers[tier] = { model: models[tier], source: "config" };
        }
      }
    } catch {
      // Ignore malformed config
    }
  }
}

function loadFromEnv(): void {
  const envMap: Record<ModelTier, string> = {
    pro:  "MINI_CLAUDE_MODEL_PRO",
    lite: "MINI_CLAUDE_MODEL_LITE",
    mini: "MINI_CLAUDE_MODEL_MINI",
  };

  for (const tier of ["pro", "lite", "mini"] as ModelTier[]) {
    const val = process.env[envMap[tier]];
    if (val) {
      tiers[tier] = { model: val, source: "env" };
    }
  }

  // Legacy: MINI_CLAUDE_MODEL overrides pro tier
  const legacy = process.env.MINI_CLAUDE_MODEL;
  if (legacy) {
    tiers.pro = { model: legacy, source: "env" };
  }
}

// ─── Runtime API ────────────────────────────────────────────

/** Get the resolved model name for a tier */
export function getModelForTier(tier: ModelTier): string {
  initModelTiers();
  return tiers[tier].model;
}

/** Get full config for a tier */
export function getTierConfig(tier: ModelTier): ModelTierConfig {
  initModelTiers();
  return {
    tier,
    model: tiers[tier].model,
    description: TIER_DESCRIPTIONS[tier],
    source: tiers[tier].source,
  };
}

/** Get all tier configs */
export function getAllTierConfigs(): Record<ModelTier, ModelTierConfig> {
  initModelTiers();
  return {
    pro:  getTierConfig("pro"),
    lite: getTierConfig("lite"),
    mini: getTierConfig("mini"),
  };
}

/**
 * Runtime switch — highest priority. Used by `/model pro <name>`.
 */
export function setTierModel(tier: ModelTier, modelName: string): void {
  initModelTiers();
  tiers[tier] = { model: modelName, source: "runtime" };
}

/** Check if a string is a valid tier name */
export function isTierName(s: string): s is ModelTier {
  return s === "pro" || s === "lite" || s === "mini";
}

// ─── Sub-agent model routing ────────────────────────────────

/**
 * Resolve which model a sub-agent should use.
 *
 * Priority: explicit model param > agent-type-based tier routing.
 * The explicit model can be a tier name ("lite") or a full model name.
 */
export function resolveSubAgentModel(
  agentType: string,
  explicitModel?: string,
): { model: string; tier: ModelTier; source: string } {
  // 1. Explicit model specified in tool call
  if (explicitModel) {
    if (isTierName(explicitModel)) {
      const tier = explicitModel;
      return { model: getModelForTier(tier), tier, source: `explicit-tier:${tier}` };
    }
    return { model: explicitModel, tier: "pro", source: "explicit-model" };
  }

  // 2. Route by agent type
  const tier = AGENT_TYPE_TIER_MAP[agentType] || "pro";
  return { model: getModelForTier(tier), tier, source: `auto:${tier}` };
}

// ─── Display helpers ────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  default: "built-in",
  config:  "settings.json",
  env:     "env var",
  runtime: "runtime",
};

export function formatTierInfo(): string {
  initModelTiers();
  const lines: string[] = [];
  for (const tier of ["pro", "lite", "mini"] as ModelTier[]) {
    const cfg = getTierConfig(tier);
    const src = SOURCE_LABELS[cfg.source] || cfg.source;
    lines.push(`  ${tier.toUpperCase().padEnd(5)} ${cfg.model.padEnd(35)} [${src}]`);
    lines.push(`        ${cfg.description}`);
  }
  return lines.join("\n");
}

// ─── Reset (for testing) ───────────────────────────────────

export function resetModelTiers(): void {
  initialized = false;
  for (const tier of ["pro", "lite", "mini"] as ModelTier[]) {
    tiers[tier] = { model: DEFAULT_MODELS[tier], source: "default" };
  }
}
