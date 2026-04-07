import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isRetryable, withRetry } from "../../../src/core/agent-retry.js";

describe("agent-retry", () => {
  describe("isRetryable", () => {
    it("should return true for 429 (rate limit)", () => {
      expect(isRetryable({ status: 429 })).toBe(true);
    });

    it("should return true for 503 (service unavailable)", () => {
      expect(isRetryable({ status: 503 })).toBe(true);
    });

    it("should return true for 529 (overloaded)", () => {
      expect(isRetryable({ status: 529 })).toBe(true);
    });

    it("should return true for ECONNRESET", () => {
      expect(isRetryable({ code: "ECONNRESET" })).toBe(true);
    });

    it("should return true for ETIMEDOUT", () => {
      expect(isRetryable({ code: "ETIMEDOUT" })).toBe(true);
    });

    it("should return true for overloaded message", () => {
      expect(isRetryable({ message: "The server is overloaded" })).toBe(true);
    });

    it("should return false for 400 (bad request)", () => {
      expect(isRetryable({ status: 400 })).toBe(false);
    });

    it("should return false for 401 (unauthorized)", () => {
      expect(isRetryable({ status: 401 })).toBe(false);
    });

    it("should return false for 404 (not found)", () => {
      expect(isRetryable({ status: 404 })).toBe(false);
    });

    it("should return false for undefined error", () => {
      expect(isRetryable(undefined)).toBe(false);
    });

    it("should return false for null error", () => {
      expect(isRetryable(null)).toBe(false);
    });

    it("should return false for generic error", () => {
      expect(isRetryable(new Error("Something went wrong"))).toBe(false);
    });

    it("should prefer status over code", () => {
      expect(isRetryable({ status: 429, code: "BAD_REQUEST" })).toBe(true);
    });

    it("should check statusCode as well", () => {
      expect(isRetryable({ statusCode: 503 })).toBe(true);
    });
  });

  describe("withRetry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return result on success", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      const result = await withRetry(fn);
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on retryable error", async () => {
      const error = { status: 429, message: "Rate limited" };
      const fn = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("recovered");

      const onRetry = vi.fn();
      const resultPromise = withRetry(fn, { maxRetries: 3, onRetry });

      // Advance past the delay
      await vi.advanceTimersByTimeAsync(2000);

      const result = await resultPromise;
      expect(result).toBe("recovered");
      expect(fn).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxRetries: 3,
          reason: "HTTP 429",
        })
      );
    });

    it("should stop retrying after maxRetries", async () => {
      const error = { status: 503, message: "Service unavailable" };
      const fn = vi.fn().mockRejectedValue(error);

      // We track the promise manually to avoid fake-timer unhandled rejection race
      let caughtError: any = null;
      const resultPromise = withRetry(fn, { maxRetries: 2 })
        .catch((e) => { caughtError = e; return undefined; });

      await vi.advanceTimersByTimeAsync(60000);
      await resultPromise;

      expect(caughtError).toEqual(error);
      expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it("should not retry non-retryable errors", async () => {
      const error = { status: 400, message: "Bad request" };
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn)).rejects.toEqual(error);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should throw immediately on abort", async () => {
      const controller = new AbortController();
      const error = { status: 429, message: "Rate limited" };
      const fn = vi.fn().mockRejectedValue(error);

      controller.abort();

      const resultPromise = withRetry(fn, {
        signal: controller.signal,
        maxRetries: 3,
      });

      await expect(resultPromise).rejects.toEqual(error);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should use exponential backoff with jitter", async () => {
      const error = { status: 429, message: "Rate limited" };
      const fn = vi.fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("ok");

      const delays: number[] = [];
      const onRetry = vi.fn((info) => {
        delays.push(info.delayMs);
      });

      const resultPromise = withRetry(fn, { maxRetries: 5, onRetry });

      // First retry delay: ~1000ms + random(0,1000)
      await vi.advanceTimersByTimeAsync(2000);
      // Second retry delay: ~2000ms + random(0,1000)
      await vi.advanceTimersByTimeAsync(3000);

      const result = await resultPromise;
      expect(result).toBe("ok");
      expect(onRetry).toHaveBeenCalledTimes(2);

      // Verify exponential backoff: second delay should be larger
      expect(delays[1]).toBeGreaterThan(delays[0]);
    });

    it("should default maxRetries to 3", async () => {
      const error = { status: 503, message: "Unavailable" };
      const fn = vi.fn().mockRejectedValue(error);

      let caughtError: any = null;
      const resultPromise = withRetry(fn)
        .catch((e) => { caughtError = e; return undefined; });

      await vi.advanceTimersByTimeAsync(60000);
      await resultPromise;

      expect(caughtError).toEqual(error);
      expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it("should pass signal to fn", async () => {
      const controller = new AbortController();
      const signal = controller.signal;
      const fn = vi.fn().mockResolvedValue("ok");

      await withRetry(fn, { signal });
      expect(fn).toHaveBeenCalledWith(signal);
    });

    it("should report network error reason", async () => {
      const error = { code: "ECONNRESET", message: "Connection reset" };
      const fn = vi.fn().mockRejectedValue(error);

      const onRetry = vi.fn();
      let caughtError: any = null;
      const resultPromise = withRetry(fn, { maxRetries: 1, onRetry })
        .catch((e) => { caughtError = e; return undefined; });

      await vi.advanceTimersByTimeAsync(2000);
      await resultPromise;

      expect(caughtError).toEqual(error);
      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "ECONNRESET" })
      );
    });
  });
});
