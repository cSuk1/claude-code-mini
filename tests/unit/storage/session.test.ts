import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";

// vi.hoisted runs before any imports — use require for Node builtins
const { TEST_HOME } = vi.hoisted(() => {
  const nodePath = require("path");
  const nodeOs = require("os");
  const nodeCrypto = require("crypto");
  return {
    TEST_HOME: nodePath.join(nodeOs.tmpdir(), `ccmini-session-test-${nodeCrypto.randomUUID()}`),
  };
});

vi.mock("os", async () => {
  const actual = await vi.importActual<typeof import("os")>("os");
  return {
    ...actual,
    homedir: () => TEST_HOME,
  };
});

// Import session module AFTER mock is set up
import { saveSession, loadSession, listSessions, getLatestSessionId } from "../../../src/storage/session.js";
import { join } from "path";

describe("session", () => {
  beforeEach(() => {
    mkdirSync(join(TEST_HOME, ".ccmini", "sessions"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(TEST_HOME, { recursive: true, force: true });
    } catch {}
  });

  describe("saveSession", () => {
    it("should save session to file", () => {
      const data = {
        metadata: {
          id: "test-1",
          model: "glm-5",
          cwd: "/test",
          startTime: "2025-01-01T00:00:00Z",
          messageCount: 5,
        },
        anthropicMessages: [{ role: "user", content: "Hello" }],
      };

      saveSession("test-1", data);

      const filePath = join(TEST_HOME, ".ccmini", "sessions", "test-1.json");
      expect(existsSync(filePath)).toBe(true);

      const content = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(content.metadata.id).toBe("test-1");
      expect(content.metadata.model).toBe("glm-5");
      expect(content.anthropicMessages).toHaveLength(1);
    });

    it("should create sessions directory if not exists", () => {
      try { rmSync(join(TEST_HOME, ".ccmini", "sessions"), { recursive: true }); } catch {}

      saveSession("test-dir", {
        metadata: {
          id: "test-dir",
          model: "glm-5",
          cwd: "/test",
          startTime: "2025-01-01T00:00:00Z",
          messageCount: 0,
        },
      });

      expect(existsSync(join(TEST_HOME, ".ccmini", "sessions"))).toBe(true);
    });
  });

  describe("loadSession", () => {
    it("should load existing session", () => {
      saveSession("load-1", {
        metadata: {
          id: "load-1",
          model: "gpt-4o",
          cwd: "/project",
          startTime: "2025-06-01T00:00:00Z",
          messageCount: 3,
        },
        openaiMessages: [{ role: "user", content: "Hi" }],
      });

      const session = loadSession("load-1");
      expect(session).not.toBeNull();
      expect(session!.metadata.id).toBe("load-1");
      expect(session!.metadata.model).toBe("gpt-4o");
      expect(session!.openaiMessages).toHaveLength(1);
    });

    it("should return null for non-existent session", () => {
      expect(loadSession("nonexistent")).toBeNull();
    });

    it("should return null for corrupt session file", () => {
      const filePath = join(TEST_HOME, ".ccmini", "sessions", "corrupt.json");
      writeFileSync(filePath, "not json at all");

      expect(loadSession("corrupt")).toBeNull();
    });
  });

  describe("listSessions", () => {
    it("should return empty array when no sessions", () => {
      const sessions = listSessions();
      expect(sessions).toEqual([]);
    });

    it("should list all saved sessions", () => {
      saveSession("list-1", {
        metadata: {
          id: "list-1",
          model: "glm-5",
          cwd: "/a",
          startTime: "2025-01-01T00:00:00Z",
          messageCount: 1,
        },
      });

      saveSession("list-2", {
        metadata: {
          id: "list-2",
          model: "gpt-4o",
          cwd: "/b",
          startTime: "2025-06-01T00:00:00Z",
          messageCount: 5,
        },
      });

      const sessions = listSessions();
      expect(sessions).toHaveLength(2);
      const ids = sessions.map(s => s.id);
      expect(ids).toContain("list-1");
      expect(ids).toContain("list-2");
    });

    it("should skip corrupt session files", () => {
      const filePath = join(TEST_HOME, ".ccmini", "sessions", "bad.json");
      writeFileSync(filePath, "not valid json");

      saveSession("good-1", {
        metadata: {
          id: "good-1",
          model: "glm-5",
          cwd: "/a",
          startTime: "2025-01-01T00:00:00Z",
          messageCount: 0,
        },
      });

      const sessions = listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe("good-1");
    });
  });

  describe("getLatestSessionId", () => {
    it("should return null when no sessions", () => {
      expect(getLatestSessionId()).toBeNull();
    });

    it("should return the most recent session id", () => {
      saveSession("old-session", {
        metadata: {
          id: "old-session",
          model: "glm-5",
          cwd: "/a",
          startTime: "2024-01-01T00:00:00Z",
          messageCount: 1,
        },
      });

      saveSession("new-session", {
        metadata: {
          id: "new-session",
          model: "glm-5",
          cwd: "/a",
          startTime: "2025-06-01T00:00:00Z",
          messageCount: 2,
        },
      });

      expect(getLatestSessionId()).toBe("new-session");
    });
  });
});
