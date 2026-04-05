import { Agent } from "./agent.js";
import { getSubAgentConfig, BUILTIN_AGENT_TYPES, type SubAgentType } from "../extensions/subagent.js";
import { resolveSubAgentModel } from "./model-tiers.js";
import type { ToolDef } from "../tools/tools.js";
import { printSubAgentStart, printSubAgentEnd } from "../ui/index.js";
import { printError } from "../ui/index.js";

/**
 * Base interface for execution strategies
 */
export interface ExecutionStrategy {
  execute(agent: Agent, input: Record<string, any>): Promise<string>;
}

/**
 * Sub-agent execution strategy
 */
export class AgentStrategy implements ExecutionStrategy {
  async execute(agent: Agent, input: Record<string, any>): Promise<string> {
    const type = (input.type || "general") as SubAgentType;
    const description = input.description || "sub-agent task";
    const prompt = input.prompt || "";
    const explicitModel = input.model as string | undefined;

    const config = getSubAgentConfig(type);
    const routing = resolveSubAgentModel(type, explicitModel || config.model);

    printSubAgentStart(type, `${description} [${routing.tier}:${routing.model}]`);

    const subAgent = new Agent({
      model: routing.model,
      apiBase: agent["apiBase"] as string | undefined,
      apiKey: agent["apiKey"] as string | undefined,
      anthropicBaseURL: agent["anthropicBaseURL"] as string | undefined,
      customSystemPrompt: config.systemPrompt,
      customTools: config.tools,
      isSubAgent: true,
      permissionMode: "bypassPermissions",
    });

    try {
      const result = await subAgent.runOnce(prompt);
      // Aggregate token usage
      const totalInput = agent["totalInputTokens"] as number;
      const totalOutput = agent["totalOutputTokens"] as number;
      (agent as any).totalInputTokens = totalInput + result.tokens.input;
      (agent as any).totalOutputTokens = totalOutput + result.tokens.output;
      printSubAgentEnd(type, description);
      return result.text || "(Sub-agent produced no output)";
    } catch (e: any) {
      printSubAgentEnd(type, description);
      return `Sub-agent error: ${e.message}`;
    }
  }
}

/**
 * Skill execution strategy
 */
export class SkillStrategy implements ExecutionStrategy {
  async execute(agent: Agent, input: Record<string, any>): Promise<string> {
    const { executeSkill } = await import("../extensions/skills.js");
    const skillName = input.skill_name;
    const result = executeSkill(skillName, input.args || "");

    if (!result) return `Unknown skill: ${skillName}`;

    if (result.context === "fork") {
      const tools = result.allowedTools
        ? (agent["tools"] as ToolDef[]).filter(t => result.allowedTools!.includes(t.name))
        : (agent["tools"] as ToolDef[]).filter(t => t.name !== "agent");

      const routing = resolveSubAgentModel(BUILTIN_AGENT_TYPES.EXPLORE, result.model);

      printSubAgentStart("skill-fork", `${skillName} [${routing.tier}:${routing.model}]`);
      const subAgent = new Agent({
        model: routing.model,
        apiBase: agent["apiBase"] as string | undefined,
        apiKey: agent["apiKey"] as string | undefined,
        anthropicBaseURL: agent["anthropicBaseURL"] as string | undefined,
        customSystemPrompt: result.prompt,
        customTools: tools,
        isSubAgent: true,
        permissionMode: "bypassPermissions",
      });

      try {
        const subResult = await subAgent.runOnce(input.args || "Execute this skill task.");
        const totalInput = agent["totalInputTokens"] as number;
        const totalOutput = agent["totalOutputTokens"] as number;
        (agent as any).totalInputTokens = totalInput + subResult.tokens.input;
        (agent as any).totalOutputTokens = totalOutput + subResult.tokens.output;
        printSubAgentEnd("skill-fork", skillName);
        return subResult.text || "(Skill produced no output)";
      } catch (e: any) {
        printSubAgentEnd("skill-fork", skillName);
        return `Skill fork error: ${e.message}`;
      }
    }

    return `[Skill "${skillName}" activated]\n\n${result.prompt}`;
  }
}

/**
 * Registry for tool execution strategies
 */
export class ToolStrategyRegistry {
  private strategies = new Map<string, ExecutionStrategy>();

  constructor() {
    this.register("agent", new AgentStrategy());
    this.register("skill", new SkillStrategy());
  }

  register(name: string, strategy: ExecutionStrategy): void {
    this.strategies.set(name, strategy);
  }

  get(name: string): ExecutionStrategy | undefined {
    return this.strategies.get(name);
  }

  has(name: string): boolean {
    return this.strategies.has(name);
  }
}

// Global registry instance
export const toolStrategies = new ToolStrategyRegistry();