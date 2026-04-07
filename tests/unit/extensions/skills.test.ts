import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  discoverSkills,
  getSkillByName,
  resolveSkillPrompt,
  executeSkill,
  buildSkillDescriptions,
  resetSkillCache,
  type SkillDefinition,
} from "../../../src/extensions/skills.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";

const testBaseDir = join(tmpdir(), `ccmini-skills-test-${randomUUID()}`);

function setupSkillDir(
  source: "project" | "user",
  skillName: string,
  content: string
): string {
  const dir = join(
    testBaseDir,
    source === "user" ? ".ccmini/skills" : ".ccmini/skills",
    skillName
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
  return dir;
}

describe("skills", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    mkdirSync(testBaseDir, { recursive: true });
    mkdirSync(join(testBaseDir, ".ccmini", "skills"), { recursive: true });
    process.chdir(testBaseDir);
    resetSkillCache();
  });

  afterEach(() => {
    resetSkillCache();
    process.chdir(originalCwd);
    try {
      rmSync(testBaseDir, { recursive: true, force: true });
    } catch {}
  });

  describe("discoverSkills", () => {
    it("should return empty array when no skills", () => {
      const skills = discoverSkills();
      expect(skills).toEqual([]);
    });

    it("should discover project-level skills", () => {
      const content = [
        "---",
        "name: test-skill",
        "description: A test skill",
        "user-invocable: true",
        "---",
        "Skill prompt template with $ARGUMENTS",
      ].join("\n");

      setupSkillDir("project", "test-skill", content);
      resetSkillCache();

      const skills = discoverSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("test-skill");
      expect(skills[0].description).toBe("A test skill");
      expect(skills[0].source).toBe("project");
    });

    it("should default user-invocable to true", () => {
      const content = [
        "---",
        "name: default-invocable",
        "description: Test",
        "---",
        "Prompt",
      ].join("\n");

      setupSkillDir("project", "default-invocable", content);
      resetSkillCache();

      const skills = discoverSkills();
      expect(skills[0].userInvocable).toBe(true);
    });

    it("should parse context as fork", () => {
      const content = [
        "---",
        "name: fork-skill",
        "description: Fork skill",
        "context: fork",
        "---",
        "Fork prompt",
      ].join("\n");

      setupSkillDir("project", "fork-skill", content);
      resetSkillCache();

      const skills = discoverSkills();
      expect(skills[0].context).toBe("fork");
    });

    it("should default context to inline", () => {
      const content = [
        "---",
        "name: inline-skill",
        "description: Inline skill",
        "---",
        "Inline prompt",
      ].join("\n");

      setupSkillDir("project", "inline-skill", content);
      resetSkillCache();

      const skills = discoverSkills();
      expect(skills[0].context).toBe("inline");
    });

    it("should parse allowed-tools as comma-separated", () => {
      const content = [
        "---",
        "name: restricted-skill",
        "description: Restricted skill",
        "allowed-tools: read_file, list_files",
        "---",
        "Prompt",
      ].join("\n");

      setupSkillDir("project", "restricted-skill", content);
      resetSkillCache();

      const skills = discoverSkills();
      expect(skills[0].allowedTools).toEqual(["read_file", "list_files"]);
    });

    it("should parse allowed-tools as JSON array", () => {
      const content = [
        "---",
        "name: json-tools",
        'allowed-tools: ["read_file", "grep_search"]',
        "description: JSON tools",
        "---",
        "Prompt",
      ].join("\n");

      setupSkillDir("project", "json-tools", content);
      resetSkillCache();

      const skills = discoverSkills();
      expect(skills[0].allowedTools).toEqual(["read_file", "grep_search"]);
    });

    it("should parse when-to-use and model", () => {
      const content = [
        "---",
        "name: full-meta",
        "description: Full metadata skill",
        "when-to-use: When analyzing code",
        "model: lite",
        "---",
        "Prompt",
      ].join("\n");

      setupSkillDir("project", "full-meta", content);
      resetSkillCache();

      const skills = discoverSkills();
      expect(skills[0].whenToUse).toBe("When analyzing code");
      expect(skills[0].model).toBe("lite");
    });

    it("should use directory name as skill name when not specified", () => {
      const content = [
        "---",
        "description: No name skill",
        "---",
        "Prompt",
      ].join("\n");

      setupSkillDir("project", "auto-named", content);
      resetSkillCache();

      const skills = discoverSkills();
      expect(skills[0].name).toBe("auto-named");
    });

    it("should cache results", () => {
      const content = [
        "---",
        "name: cached-skill",
        "description: Cached",
        "---",
        "Prompt",
      ].join("\n");

      setupSkillDir("project", "cached-skill", content);
      resetSkillCache();

      const first = discoverSkills();
      const second = discoverSkills();
      expect(first).toBe(second); // same reference
    });

    it("should handle invalid skill files gracefully", () => {
      const dir = join(testBaseDir, ".ccmini", "skills", "broken-skill");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), "not valid frontmatter {{{");
      resetSkillCache();

      const skills = discoverSkills();
      // parseFrontmatter treats invalid YAML as empty meta, so skill is created with defaults
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("broken-skill");
    });
  });

  describe("getSkillByName", () => {
    it("should return skill by name", () => {
      const content = [
        "---",
        "name: find-me",
        "description: Findable",
        "---",
        "Prompt",
      ].join("\n");

      setupSkillDir("project", "find-me", content);
      resetSkillCache();

      const skill = getSkillByName("find-me");
      expect(skill).not.toBeNull();
      expect(skill!.name).toBe("find-me");
    });

    it("should return null for unknown skill", () => {
      expect(getSkillByName("nonexistent")).toBeNull();
    });
  });

  describe("resolveSkillPrompt", () => {
    it("should replace $ARGUMENTS", () => {
      const skill: SkillDefinition = {
        name: "test",
        description: "Test",
        context: "inline",
        promptTemplate: "Search for: $ARGUMENTS",
        source: "project",
        skillDir: "/tmp",
        userInvocable: true,
      };

      const result = resolveSkillPrompt(skill, "my query");
      expect(result).toBe("Search for: my query");
    });

    it("should replace ${ARGUMENTS}", () => {
      const skill: SkillDefinition = {
        name: "test",
        description: "Test",
        context: "inline",
        promptTemplate: "Query: ${ARGUMENTS}",
        source: "project",
        skillDir: "/tmp",
        userInvocable: true,
      };

      const result = resolveSkillPrompt(skill, "my query");
      expect(result).toBe("Query: my query");
    });

    it("should replace ${CLAUDE_SKILL_DIR}", () => {
      const skill: SkillDefinition = {
        name: "test",
        description: "Test",
        context: "inline",
        promptTemplate: "Dir: ${CLAUDE_SKILL_DIR}",
        source: "project",
        skillDir: "/path/to/skill",
        userInvocable: true,
      };

      const result = resolveSkillPrompt(skill, "");
      expect(result).toBe("Dir: /path/to/skill");
    });

    it("should handle empty args", () => {
      const skill: SkillDefinition = {
        name: "test",
        description: "Test",
        context: "inline",
        promptTemplate: "No args needed",
        source: "project",
        skillDir: "/tmp",
        userInvocable: true,
      };

      expect(resolveSkillPrompt(skill, "")).toBe("No args needed");
    });
  });

  describe("executeSkill", () => {
    it("should return null for unknown skill", () => {
      expect(executeSkill("nonexistent", "args")).toBeNull();
    });

    it("should return skill result for known skill", () => {
      const content = [
        "---",
        "name: exec-test",
        "description: Exec test",
        "---",
        "Process: $ARGUMENTS",
      ].join("\n");

      setupSkillDir("project", "exec-test", content);
      resetSkillCache();

      const result = executeSkill("exec-test", "some data");
      expect(result).not.toBeNull();
      expect(result!.prompt).toBe("Process: some data");
      expect(result!.context).toBe("inline");
    });
  });

  describe("buildSkillDescriptions", () => {
    it("should return empty string when no skills", () => {
      resetSkillCache();
      expect(buildSkillDescriptions()).toBe("");
    });

    it("should build descriptions for user-invocable skills", () => {
      const content = [
        "---",
        "name: my-skill",
        "description: A great skill",
        "user-invocable: true",
        "---",
        "Prompt",
      ].join("\n");

      setupSkillDir("project", "my-skill", content);
      resetSkillCache();

      const desc = buildSkillDescriptions();
      expect(desc).toContain("Available Skills");
      expect(desc).toContain("/my-skill");
      expect(desc).toContain("A great skill");
    });

    it("should separate auto-only skills", () => {
      const autoContent = [
        "---",
        "name: auto-skill",
        "description: Auto only",
        "user-invocable: false",
        "---",
        "Auto prompt",
      ].join("\n");

      setupSkillDir("project", "auto-skill", autoContent);
      resetSkillCache();

      const desc = buildSkillDescriptions();
      expect(desc).toContain("Auto-invocable skills");
      expect(desc).toContain("auto-skill");
    });
  });

  describe("resetSkillCache", () => {
    it("should clear cached skills", () => {
      const content = [
        "---",
        "name: cached",
        "description: Cached skill",
        "---",
        "Prompt",
      ].join("\n");

      setupSkillDir("project", "cached", content);
      resetSkillCache();

      const first = discoverSkills();
      resetSkillCache();
      const second = discoverSkills();
      expect(first).not.toBe(second); // different references
    });
  });
});
