const MODEL_CONTEXT: Record<string, number> = {
  "minimax-m2.5": 200000,
  "kimi-k2.5": 200000,
  "glm-5": 200000,
};

export function getContextWindow(model: string): number {
  return MODEL_CONTEXT[model] || 200000;
}

export function isInternalModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return MODEL_CONTEXT[model] !== undefined;
}

export function modelSupportsThinking(model: string): boolean {
  const normalized = model.toLowerCase();
  if (normalized.includes("claude-3-") || normalized.includes("3-5-") || normalized.includes("3-7-")) {
    return false;
  }
  if (normalized.includes("claude") && (normalized.includes("opus") || normalized.includes("sonnet") || normalized.includes("haiku"))) {
    return true;
  }
  return false;
}

export function modelSupportsAdaptiveThinking(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes("opus-4-6") || normalized.includes("sonnet-4-6");
}

export function getMaxOutputTokens(model: string): number {
  const normalized = model.toLowerCase();
  if (normalized.includes("opus-4-6")) return 64000;
  if (normalized.includes("sonnet-4-6")) return 32000;
  if (normalized.includes("opus-4") || normalized.includes("sonnet-4") || normalized.includes("haiku-4")) return 32000;
  return 16384;
}
