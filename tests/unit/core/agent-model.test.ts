import { describe, it, expect } from "vitest";
import {
  getContextWindow,
  isInternalModel,
  modelSupportsThinking,
  modelSupportsAdaptiveThinking,
  getMaxOutputTokens,
} from "../../../src/core/agent-model.js";

describe("agent-model", () => {
  describe("getContextWindow", () => {
    it("should return context window for known models", () => {
      expect(getContextWindow("minimax-m2.5")).toBe(200000);
      expect(getContextWindow("kimi-k2.5")).toBe(200000);
      expect(getContextWindow("glm-5")).toBe(200000);
    });

    it("should return default 200000 for unknown models", () => {
      expect(getContextWindow("gpt-4o")).toBe(200000);
      expect(getContextWindow("claude-3-opus")).toBe(200000);
      expect(getContextWindow("unknown-model")).toBe(200000);
    });
  });

  describe("isInternalModel", () => {
    it("should return true for known internal models", () => {
      expect(isInternalModel("glm-5")).toBe(true);
      expect(isInternalModel("minimax-m2.5")).toBe(true);
      expect(isInternalModel("kimi-k2.5")).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(isInternalModel("GLM-5")).toBe(true);
      expect(isInternalModel("Glm-5")).toBe(true);
    });

    it("should return false for external models", () => {
      expect(isInternalModel("gpt-4o")).toBe(false);
      expect(isInternalModel("claude-3-opus")).toBe(false);
      expect(isInternalModel("deepseek-v3")).toBe(false);
    });
  });

  describe("modelSupportsThinking", () => {
    it("should return false for Claude 3 models", () => {
      expect(modelSupportsThinking("claude-3-opus")).toBe(false);
      expect(modelSupportsThinking("claude-3-sonnet")).toBe(false);
      expect(modelSupportsThinking("claude-3-haiku")).toBe(false);
      expect(modelSupportsThinking("claude-3-5-sonnet")).toBe(false);
      expect(modelSupportsThinking("claude-3-7-sonnet")).toBe(false);
    });

    it("should return true for Claude 4+ models", () => {
      expect(modelSupportsThinking("claude-sonnet-4-20250514")).toBe(true);
      expect(modelSupportsThinking("claude-opus-4")).toBe(true);
      expect(modelSupportsThinking("claude-haiku-4")).toBe(true);
    });

    it("should return true for Claude models with known names", () => {
      expect(modelSupportsThinking("claude-opus")).toBe(true);
      expect(modelSupportsThinking("claude-sonnet")).toBe(true);
      expect(modelSupportsThinking("claude-haiku")).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(modelSupportsThinking("CLAUDE-SONNET-4")).toBe(true);
      expect(modelSupportsThinking("Claude-Opus")).toBe(true);
    });

    it("should return false for non-Claude models", () => {
      expect(modelSupportsThinking("gpt-4o")).toBe(false);
      expect(modelSupportsThinking("glm-5")).toBe(false);
    });
  });

  describe("modelSupportsAdaptiveThinking", () => {
    it("should return true for Claude Opus 4.6", () => {
      expect(modelSupportsAdaptiveThinking("claude-opus-4-6")).toBe(true);
    });

    it("should return true for Claude Sonnet 4.6", () => {
      expect(modelSupportsAdaptiveThinking("claude-sonnet-4-6")).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(modelSupportsAdaptiveThinking("CLAUDE-OPUS-4-6")).toBe(true);
    });

    it("should return false for other models", () => {
      expect(modelSupportsAdaptiveThinking("claude-sonnet-4")).toBe(false);
      expect(modelSupportsAdaptiveThinking("claude-opus-4")).toBe(false);
      expect(modelSupportsAdaptiveThinking("gpt-4o")).toBe(false);
    });
  });

  describe("getMaxOutputTokens", () => {
    it("should return 64000 for Claude Opus 4.6", () => {
      expect(getMaxOutputTokens("claude-opus-4-6")).toBe(64000);
    });

    it("should return 32000 for Claude Sonnet 4.6", () => {
      expect(getMaxOutputTokens("claude-sonnet-4-6")).toBe(32000);
    });

    it("should return 32000 for Claude 4 base models", () => {
      expect(getMaxOutputTokens("claude-opus-4")).toBe(32000);
      expect(getMaxOutputTokens("claude-sonnet-4")).toBe(32000);
      expect(getMaxOutputTokens("claude-haiku-4")).toBe(32000);
    });

    it("should return default 16384 for other models", () => {
      expect(getMaxOutputTokens("gpt-4o")).toBe(16384);
      expect(getMaxOutputTokens("glm-5")).toBe(16384);
      expect(getMaxOutputTokens("claude-3-opus")).toBe(16384);
    });

    it("should be case-insensitive", () => {
      expect(getMaxOutputTokens("CLAUDE-OPUS-4-6")).toBe(64000);
    });
  });
});
