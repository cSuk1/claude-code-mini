// Model tier system — three-tier model hierarchy for different task complexities.
// Pro: Main conversation model (most capable)
// Lite: Lightweight tasks (sub-agents, exploration)
// Mini: Minimal tasks (simple queries, quick checks)

export type ModelTier = "pro" | "lite" | "mini";

export interface ModelTierConfig {
  tier: ModelTier;
  name: string;
  description: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsThinking: boolean;
  costTier: string;  // "high" | "medium" | "low"
}

// ─── Model definitions ────────────────────────────────────────

const MODEL_TIERS: Record<ModelTier, ModelTierConfig> = {
  pro: {
    tier: "pro",
    name: "claude-sonnet-4-20250514",
    description: "Main conversation model - most capable for complex tasks",
    contextWindow: 200000,
    maxOutputTokens: 32000,
    supportsThinking: true,
    costTier: "high",
  },
  lite: {
    tier: "lite",
    name: "claude-3-5-haiku-20241022",
    description: "Lightweight model for sub-agents and exploration tasks",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsThinking: false,
    costTier: "medium",
  },
  mini: {
    tier: "mini",
    name: "claude-3-5-haiku-20241022",
    description: "Minimal model for quick queries and simple checks",
    contextWindow: 200000,
    maxOutputTokens: 4096,
    supportsThinking: false,
    costTier: "low",
  },
};

// ─── Tier management ────────────────────────────────────────

let currentTiers: Record<ModelTier, ModelTierConfig> = { ...MODEL_TIERS };

export function getModelForTier(tier: ModelTier): string {
  return currentTiers[tier].name;
}

export function getTierConfig(tier: ModelTier): ModelTierConfig {
  return currentTiers[tier];
}

export function setModelForTier(tier: ModelTier, modelName: string): void {
  currentTiers[tier] = {
    ...currentTiers[tier],
    name: modelName,
  };
}

export function configureTiers(config: Partial<Record<ModelTier, string>>): void {
  for (const [tier, modelName] of Object.entries(config)) {
    if (modelName) {
      setModelForTier(tier as ModelTier, modelName);
    }
  }
}

export function getAllTierConfigs(): Record<ModelTier, ModelTierConfig> {
  return { ...currentTiers };
}

// ─── Task-based model selection ──────────────────────────────

export type TaskType = 
  | "main-conversation"
  | "sub-agent-explore"
  | "sub-agent-plan"
  | "sub-agent-general"
  | "quick-query"
  | "simple-check";

export function getModelForTask(task: TaskType): string {
  const tierMap: Record<TaskType, ModelTier> = {
    "main-conversation": "pro",
    "sub-agent-explore": "lite",
    "sub-agent-plan": "lite",
    "sub-agent-general": "lite",
    "quick-query": "mini",
    "simple-check": "mini",
  };
  
  return getModelForTier(tierMap[task]);
}

// ─── CLI display ─────────────────────────────────────────────

export function formatTierInfo(): string {
  const lines: string[] = ["Model Tiers Configuration:", ""];
  
  for (const [tier, config] of Object.entries(currentTiers)) {
    const tierName = tier.toUpperCase().padEnd(5);
    lines.push(`  ${tierName} | ${config.name.padEnd(30)} | ${config.description}`);
  }
  
  return lines.join("\n");
}
