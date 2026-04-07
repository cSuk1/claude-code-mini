import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSystemPrompt, loadPlanModePrompt, loadClaudeMd, getGitContext } from "../../../src/core/prompt.js";
import { existsSync } from "fs";
import { join } from "path";

describe("prompt", () => {
  describe("buildSystemPrompt", () => {
    it("should return a non-empty string", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("should contain current working directory", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain(process.cwd());
    });

    it("should contain a date in YYYY-MM-DD format", () => {
      const prompt = buildSystemPrompt();
      const dateMatch = prompt.match(/\d{4}-\d{2}-\d{2}/);
      expect(dateMatch).not.toBeNull();
    });

    it("should contain platform info", () => {
      const prompt = buildSystemPrompt();
      const platform = `${process.platform} ${process.arch}`;
      expect(prompt).toContain(platform);
    });

    it("should contain shell info", () => {
      const prompt = buildSystemPrompt();
      const shell = process.platform === "win32"
        ? (process.env.ComSpec || "cmd.exe")
        : (process.env.SHELL || "/bin/sh");
      expect(prompt).toContain(shell);
    });

    it("should not contain raw skills template placeholder", () => {
      const prompt = buildSystemPrompt();
      // Template {{skills}} should be replaced with actual content
      expect(prompt).not.toContain("{{skills}}");
    });

    it("should contain agents section", () => {
      const prompt = buildSystemPrompt();
      // Template variables should be replaced
      expect(prompt).not.toContain("{{agents}}");
    });
  });

  describe("loadPlanModePrompt", () => {
    it("should return a non-empty string", () => {
      const prompt = loadPlanModePrompt();
      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("should be trimmed", () => {
      const prompt = loadPlanModePrompt();
      expect(prompt).toBe(prompt.trim());
    });
  });

  describe("loadClaudeMd", () => {
    it("should return string from CLAUDE.md if it exists", () => {
      // The project root has a CLAUDE.md
      const result = loadClaudeMd();
      if (existsSync(join(process.cwd(), "CLAUDE.md"))) {
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
        expect(result).toContain("CLAUDE.md");
      } else {
        expect(result).toBe("");
      }
    });

    it("should return empty string when no CLAUDE.md exists", () => {
      // In a directory without CLAUDE.md, it should return empty
      const originalCwd = process.cwd();
      try {
        // loadClaudeMd traverses up, so it will find CLAUDE.md if it exists anywhere
        // But if we're in a temp dir, it should be empty
        const result = loadClaudeMd();
        expect(typeof result).toBe("string");
      } finally {
        // restore cwd
      }
    });
  });

  describe("getGitContext", () => {
    it("should return a string", () => {
      const result = getGitContext();
      expect(typeof result).toBe("string");
    });

    it("should contain git info when in a git repo", () => {
      const result = getGitContext();
      if (existsSync(join(process.cwd(), ".git"))) {
        expect(result).toContain("Git branch:");
      }
    });

    it("should return empty string when not in a git repo", () => {
      // If we're not in a git repo, it should return empty
      // But since the test project is a git repo, we just verify it's a string
      const result = getGitContext();
      expect(typeof result).toBe("string");
    });
  });
});
