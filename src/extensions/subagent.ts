// Sub-agent system — fork-return pattern with built-in + custom agent types.
// Built-in types: explore (read-only), plan (structured), general (full tools), compact (summarize).
// Custom agents via .ccmini/agents/*.md.

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ToolDef } from "../tools/tools.js";
import { toolDefinitions } from "../tools/tools.js";
import { parseFrontmatter } from "../utils/frontmatter.js";

// ─── Built-in agent type constants ─────────────────────────

export const BUILTIN_AGENT_TYPES = {
  EXPLORE: "explore",
  PLAN:    "plan",
  GENERAL: "general",
  COMPACT: "compact",
} as const;

export type BuiltinAgentType = typeof BUILTIN_AGENT_TYPES[keyof typeof BUILTIN_AGENT_TYPES];

/** All built-in type names, for validation / enum usage */
export const BUILTIN_AGENT_TYPE_NAMES = Object.values(BUILTIN_AGENT_TYPES);

/** Descriptions shown in system prompt / help */
export const BUILTIN_AGENT_DESCRIPTIONS: Record<BuiltinAgentType, string> = {
  [BUILTIN_AGENT_TYPES.EXPLORE]: "Fast, read-only codebase search and exploration",
  [BUILTIN_AGENT_TYPES.PLAN]:    "Read-only analysis with structured implementation plans",
  [BUILTIN_AGENT_TYPES.GENERAL]: "Full tools for independent tasks",
  [BUILTIN_AGENT_TYPES.COMPACT]: "Conversation summarizer for context compression",
};

// ─── Types ──────────────────────────────────────────────────

export type SubAgentType = string; // Built-in or custom agent type name

export interface SubAgentConfig {
  systemPrompt: string;
  tools: ToolDef[];
  model?: string;   // from custom agent frontmatter, used for tier routing
}

interface CustomAgentDef {
  name: string;
  description: string;
  allowedTools?: string[];
  model?: string;       // tier name (pro/lite/mini) or explicit model name
  systemPrompt: string;
}

// ─── Read-only tools (for explore and plan agents) ──────────

const READ_ONLY_TOOLS = new Set(["read_file", "list_files", "grep_search"]);

function getReadOnlyTools(): ToolDef[] {
  return toolDefinitions.filter((t) => READ_ONLY_TOOLS.has(t.name));
}

// ─── Built-in agent type prompts ────────────────────────────

const BUILTIN_PROMPTS: Record<BuiltinAgentType, string> = {
  [BUILTIN_AGENT_TYPES.EXPLORE]: `You are an Explore agent — a fast, READ-ONLY sub-agent specialized for codebase exploration.

IMPORTANT CONSTRAINTS:
- You are READ-ONLY. You only have access to read_file, list_files, and grep_search.
- Do NOT attempt to modify any files.

Your job:
- Search files by patterns (list_files)
- Search code for keywords (grep_search)
- Read file contents (read_file)

Be fast and thorough. Use multiple tool calls when possible. Return a concise summary of your findings.`,

  [BUILTIN_AGENT_TYPES.PLAN]: `You are a Plan agent — a READ-ONLY sub-agent specialized for designing implementation plans.

IMPORTANT CONSTRAINTS:
- You are READ-ONLY. You only have access to read_file, list_files, and grep_search.
- Do NOT attempt to modify any files.

Your job:
- Analyze the codebase to understand the current architecture
- Design a step-by-step implementation plan
- Identify critical files that need modification
- Consider architectural trade-offs

Return a structured plan with:
1. Summary of current state
2. Step-by-step implementation steps
3. Critical files for implementation
4. Potential risks or considerations`,

  [BUILTIN_AGENT_TYPES.GENERAL]: `You are a General sub-agent handling an independent task. Complete the assigned task and return a concise result. You have access to all tools.`,

  [BUILTIN_AGENT_TYPES.COMPACT]: `You are a conversation summarizer. Be concise but preserve important details.
Summarize the conversation so far in a concise paragraph, preserving key decisions, file paths, and context needed to continue the work.`,
};

// ─── Built-in tool sets ─────────────────────────────────────

function getToolsForBuiltinType(type: BuiltinAgentType): ToolDef[] {
  switch (type) {
    case BUILTIN_AGENT_TYPES.EXPLORE:
    case BUILTIN_AGENT_TYPES.PLAN:
      return getReadOnlyTools();
    case BUILTIN_AGENT_TYPES.COMPACT:
      return [];  // Compact agent only processes text, no tools needed
    case BUILTIN_AGENT_TYPES.GENERAL:
    default:
      return toolDefinitions.filter((t) => t.name !== "agent");
  }
}

// ─── Custom agent discovery ─────────────────────────────────

let cachedCustomAgents: Map<string, CustomAgentDef> | null = null;

function discoverCustomAgents(): Map<string, CustomAgentDef> {
  if (cachedCustomAgents) return cachedCustomAgents;

  const agents = new Map<string, CustomAgentDef>();

  // User-level (lower priority)
  loadAgentsFromDir(join(homedir(), ".ccmini", "agents"), agents);
  // Project-level (higher priority, overwrites)
  loadAgentsFromDir(join(process.cwd(), ".ccmini", "agents"), agents);

  cachedCustomAgents = agents;
  return agents;
}

function loadAgentsFromDir(dir: string, agents: Map<string, CustomAgentDef>): void {
  if (!existsSync(dir)) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const filePath = join(dir, entry);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      const name = meta.name || entry.replace(/\.md$/, "");
      const allowedTools = meta["allowed-tools"]
        ? meta["allowed-tools"].split(",").map((s: string) => s.trim())
        : undefined;
      agents.set(name, {
        name,
        description: meta.description || "",
        allowedTools,
        model: meta.model || undefined,
        systemPrompt: body,
      });
    } catch {}
  }
}

// ─── Main config function ───────────────────────────────────

export function isBuiltinAgentType(type: string): type is BuiltinAgentType {
  return (BUILTIN_AGENT_TYPE_NAMES as readonly string[]).includes(type);
}

export function getSubAgentConfig(type: SubAgentType): SubAgentConfig {
  // Check custom agents first
  const custom = discoverCustomAgents().get(type);
  if (custom) {
    const tools = custom.allowedTools
      ? toolDefinitions.filter((t) => custom.allowedTools!.includes(t.name))
      : toolDefinitions.filter((t) => t.name !== "agent");
    return { systemPrompt: custom.systemPrompt, tools, model: custom.model };
  }

  // Built-in types
  if (isBuiltinAgentType(type)) {
    return {
      systemPrompt: BUILTIN_PROMPTS[type],
      tools: getToolsForBuiltinType(type),
    };
  }

  // Unknown type → fallback to general
  return {
    systemPrompt: BUILTIN_PROMPTS[BUILTIN_AGENT_TYPES.GENERAL],
    tools: getToolsForBuiltinType(BUILTIN_AGENT_TYPES.GENERAL),
  };
}

// ─── Available agent types (for system prompt) ──────────────

export function getAvailableAgentTypes(): { name: string; description: string }[] {
  const types: { name: string; description: string }[] = [];

  // Built-in types (exclude compact — it's internal only)
  for (const type of BUILTIN_AGENT_TYPE_NAMES) {
    if (type === BUILTIN_AGENT_TYPES.COMPACT) continue;
    types.push({ name: type, description: BUILTIN_AGENT_DESCRIPTIONS[type] });
  }

  // Custom agents
  for (const [name, def] of discoverCustomAgents()) {
    types.push({ name, description: def.description });
  }

  return types;
}

export function buildAgentDescriptions(): string {
  const types = getAvailableAgentTypes();
  // Only built-in user-facing types (3: explore, plan, general) → already in system prompt
  if (types.length <= 3) return "";

  const custom = types.slice(3);
  const lines = ["\n# Custom Agent Types", ""];
  for (const t of custom) {
    lines.push(`- **${t.name}**: ${t.description}`);
  }
  return lines.join("\n");
}

// Reset cache (for testing)
export function resetAgentCache(): void {
  cachedCustomAgents = null;
}
