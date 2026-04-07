import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BUILTIN_AGENT_TYPES,
  BUILTIN_AGENT_TYPE_NAMES,
  BUILTIN_AGENT_DESCRIPTIONS,
  isBuiltinAgentType,
  getSubAgentConfig,
  getAvailableAgentTypes,
  buildAgentDescriptions,
  resetAgentCache,
} from "../../../src/extensions/subagent.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";

const testBaseDir = join(tmpdir(), `ccmini-subagent-test-${randomUUID()}`);

describe("subagent", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    mkdirSync(testBaseDir, { recursive: true });
    mkdirSync(join(testBaseDir, ".ccmini", "agents"), { recursive: true });
    process.chdir(testBaseDir);
    resetAgentCache();
  });

  afterEach(() => {
    resetAgentCache();
    process.chdir(originalCwd);
    try {
      rmSync(testBaseDir, { recursive: true, force: true });
    } catch {}
  });

  describe("BUILTIN_AGENT_TYPES", () => {
    it("should have correct type constants", () => {
      expect(BUILTIN_AGENT_TYPES.EXPLORE).toBe("explore");
      expect(BUILTIN_AGENT_TYPES.PLAN).toBe("plan");
      expect(BUILTIN_AGENT_TYPES.GENERAL).toBe("general");
      expect(BUILTIN_AGENT_TYPES.COMPACT).toBe("compact");
    });
  });

  describe("BUILTIN_AGENT_TYPE_NAMES", () => {
    it("should contain all built-in type names", () => {
      expect(BUILTIN_AGENT_TYPE_NAMES).toContain("explore");
      expect(BUILTIN_AGENT_TYPE_NAMES).toContain("plan");
      expect(BUILTIN_AGENT_TYPE_NAMES).toContain("general");
      expect(BUILTIN_AGENT_TYPE_NAMES).toContain("compact");
    });

    it("should be an array of strings", () => {
      expect(BUILTIN_AGENT_TYPE_NAMES).toBeInstanceOf(Array);
      expect(BUILTIN_AGENT_TYPE_NAMES.every(n => typeof n === "string")).toBe(true);
    });
  });

  describe("BUILTIN_AGENT_DESCRIPTIONS", () => {
    it("should have descriptions for all built-in types", () => {
      for (const type of BUILTIN_AGENT_TYPE_NAMES) {
        expect(BUILTIN_AGENT_DESCRIPTIONS[type as any]).toBeDefined();
        expect(BUILTIN_AGENT_DESCRIPTIONS[type as any].length).toBeGreaterThan(0);
      }
    });
  });

  describe("isBuiltinAgentType", () => {
    it("should return true for built-in types", () => {
      expect(isBuiltinAgentType("explore")).toBe(true);
      expect(isBuiltinAgentType("plan")).toBe(true);
      expect(isBuiltinAgentType("general")).toBe(true);
      expect(isBuiltinAgentType("compact")).toBe(true);
    });

    it("should return false for unknown types", () => {
      expect(isBuiltinAgentType("unknown")).toBe(false);
      expect(isBuiltinAgentType("custom")).toBe(false);
      expect(isBuiltinAgentType("")).toBe(false);
    });
  });

  describe("getSubAgentConfig", () => {
    it("should return config for explore type", () => {
      const config = getSubAgentConfig("explore");
      expect(config.systemPrompt).toContain("Explore agent");
      expect(config.tools).toBeDefined();
      expect(config.tools.length).toBeGreaterThan(0);
      // Explore should only have read-only tools
      const toolNames = config.tools.map(t => t.name);
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("list_files");
      expect(toolNames).toContain("grep_search");
      expect(toolNames).not.toContain("write_file");
      expect(toolNames).not.toContain("run_shell");
    });

    it("should return config for plan type", () => {
      const config = getSubAgentConfig("plan");
      expect(config.systemPrompt).toContain("Plan agent");
      const toolNames = config.tools.map(t => t.name);
      expect(toolNames).toContain("read_file");
      expect(toolNames).not.toContain("write_file");
    });

    it("should return config for general type", () => {
      const config = getSubAgentConfig("general");
      expect(config.systemPrompt).toContain("General");
      // General should have most tools but not agent
      const toolNames = config.tools.map(t => t.name);
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("write_file");
      expect(toolNames).not.toContain("agent");
    });

    it("should return empty tools for compact type", () => {
      const config = getSubAgentConfig("compact");
      expect(config.tools).toEqual([]);
      expect(config.systemPrompt).toContain("summarizer");
    });

    it("should fallback to general for unknown type", () => {
      const config = getSubAgentConfig("totally-unknown");
      expect(config.systemPrompt).toContain("General");
      const toolNames = config.tools.map(t => t.name);
      expect(toolNames).toContain("read_file");
    });

    it("should load custom agent from project .ccmini/agents/", () => {
      const content = [
        "---",
        "name: my-custom-agent",
        "description: My custom agent",
        "allowed-tools: read_file, grep_search",
        "model: lite",
        "---",
        "You are a custom agent with specific instructions.",
      ].join("\n");

      const agentsDir = join(testBaseDir, ".ccmini", "agents");
      writeFileSync(join(agentsDir, "my-custom-agent.md"), content);
      resetAgentCache();

      const config = getSubAgentConfig("my-custom-agent");
      expect(config.systemPrompt).toContain("custom agent with specific instructions");
      expect(config.model).toBe("lite");
      const toolNames = config.tools.map(t => t.name);
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("grep_search");
      expect(toolNames).not.toContain("write_file");
    });

    it("should handle custom agent with no allowed-tools", () => {
      const content = [
        "---",
        "name: open-custom-agent",
        "description: Open custom agent",
        "---",
        "Custom prompt",
      ].join("\n");

      const agentsDir = join(testBaseDir, ".ccmini", "agents");
      writeFileSync(join(agentsDir, "open-custom-agent.md"), content);
      resetAgentCache();

      const config = getSubAgentConfig("open-custom-agent");
      const toolNames = config.tools.map(t => t.name);
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("write_file");
      expect(toolNames).not.toContain("agent");
    });
  });

  describe("getAvailableAgentTypes", () => {
    it("should return built-in types excluding compact", () => {
      const types = getAvailableAgentTypes();
      const names = types.map(t => t.name);
      expect(names).toContain("explore");
      expect(names).toContain("plan");
      expect(names).toContain("general");
      expect(names).not.toContain("compact");
    });

    it("should include custom agents", () => {
      const content = [
        "---",
        "name: custom-type",
        "description: A custom agent type",
        "---",
        "Custom prompt",
      ].join("\n");

      const agentsDir = join(testBaseDir, ".ccmini", "agents");
      writeFileSync(join(agentsDir, "custom-type.md"), content);
      resetAgentCache();

      const types = getAvailableAgentTypes();
      const names = types.map(t => t.name);
      expect(names).toContain("custom-type");
    });
  });

  describe("buildAgentDescriptions", () => {
    it("should return empty string when only built-in types", () => {
      resetAgentCache();
      const desc = buildAgentDescriptions();
      expect(desc).toBe("");
    });

    it("should return descriptions for custom agents", () => {
      const content = [
        "---",
        "name: custom-desc",
        "description: Custom agent for testing",
        "---",
        "Custom prompt",
      ].join("\n");

      const agentsDir = join(testBaseDir, ".ccmini", "agents");
      writeFileSync(join(agentsDir, "custom-desc.md"), content);
      resetAgentCache();

      const desc = buildAgentDescriptions();
      expect(desc).toContain("Custom Agent Types");
      expect(desc).toContain("custom-desc");
      expect(desc).toContain("Custom agent for testing");
    });
  });

  describe("resetAgentCache", () => {
    it("should clear cached custom agents", () => {
      const content = [
        "---",
        "name: cached-agent",
        "description: Cached",
        "---",
        "Prompt",
      ].join("\n");

      const agentsDir = join(testBaseDir, ".ccmini", "agents");
      writeFileSync(join(agentsDir, "cached-agent.md"), content);
      resetAgentCache();

      const first = getSubAgentConfig("cached-agent");
      resetAgentCache();
      const second = getSubAgentConfig("cached-agent");
      // Both should work, just verify no errors
      expect(first.systemPrompt).toBeDefined();
      expect(second.systemPrompt).toBeDefined();
    });
  });
});
