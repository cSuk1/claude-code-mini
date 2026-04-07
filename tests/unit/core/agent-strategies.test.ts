import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolStrategyRegistry, AgentStrategy, SkillStrategy, toolStrategies } from "../../../src/core/agent-strategies.js";

// Mock heavy dependencies before importing
vi.mock("../../../src/extensions/subagent.js", () => ({
  BUILTIN_AGENT_TYPES: { EXPLORE: "explore", PLAN: "plan", GENERAL: "general", COMPACT: "compact" },
  getSubAgentConfig: vi.fn().mockReturnValue({
    systemPrompt: "Test sub-agent prompt",
    tools: [],
    model: "test-model",
  }),
}));

vi.mock("../../../src/core/model-tiers.js", () => ({
  resolveSubAgentModel: vi.fn().mockReturnValue({ tier: "pro", model: "test-model", source: "default" }),
}));

vi.mock("../../../src/ui/index.js", () => ({
  printSubAgentStart: vi.fn(),
  printSubAgentEnd: vi.fn(),
}));

vi.mock("../../../src/extensions/skills.js", () => ({
  executeSkill: vi.fn().mockReturnValue({
    prompt: "Skill prompt",
    allowedTools: ["read_file"],
    context: "fork",
    model: undefined,
  }),
}));

describe("agent-strategies", () => {
  describe("ToolStrategyRegistry", () => {
    it("should register agent strategy", () => {
      expect(toolStrategies.has("agent")).toBe(true);
      expect(toolStrategies.get("agent")).toBeInstanceOf(AgentStrategy);
    });

    it("should register skill strategy", () => {
      expect(toolStrategies.has("skill")).toBe(true);
      expect(toolStrategies.get("skill")).toBeInstanceOf(SkillStrategy);
    });

    it("should return undefined for unknown strategy", () => {
      expect(toolStrategies.get("unknown")).toBeUndefined();
      expect(toolStrategies.has("unknown")).toBe(false);
    });
  });

  describe("AgentStrategy", () => {
    let strategy: AgentStrategy;

    beforeEach(() => {
      strategy = new AgentStrategy();
      vi.clearAllMocks();
    });

    it("should have execute method", () => {
      expect(typeof strategy.execute).toBe("function");
    });

    it("should be an ExecutionStrategy", () => {
      expect(strategy).toHaveProperty("execute");
      expect(typeof strategy.execute).toBe("function");
    });
  });

  describe("SkillStrategy", () => {
    let strategy: SkillStrategy;

    beforeEach(() => {
      strategy = new SkillStrategy();
      vi.clearAllMocks();
    });

    it("should have execute method", () => {
      expect(typeof strategy.execute).toBe("function");
    });

    it("should be an ExecutionStrategy", () => {
      expect(strategy).toHaveProperty("execute");
      expect(typeof strategy.execute).toBe("function");
    });
  });

  describe("ToolStrategyRegistry instance methods", () => {
    let registry: ToolStrategyRegistry;

    beforeEach(() => {
      registry = new ToolStrategyRegistry();
    });

    it("should register new strategies", () => {
      const mockStrategy = { execute: vi.fn() };
      registry.register("custom", mockStrategy);
      expect(registry.has("custom")).toBe(true);
      expect(registry.get("custom")).toBe(mockStrategy);
    });

    it("should overwrite existing strategy", () => {
      const first = { execute: vi.fn() };
      const second = { execute: vi.fn() };
      registry.register("test", first);
      registry.register("test", second);
      expect(registry.get("test")).toBe(second);
    });

    it("should list only registered strategies", () => {
      expect(registry.has("agent")).toBe(true);
      expect(registry.has("skill")).toBe(true);
      expect(registry.has("nonexistent")).toBe(false);
    });
  });
});
