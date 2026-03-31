import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { toolDefinitions, executeTool, isDangerous, needsConfirmation } from "./tools.js";
import {
  printAssistantText,
  printToolCall,
  printToolResult,
  printError,
  printConfirmation,
  printDivider,
  printCost,
  printRetry,
  printInfo,
} from "./ui.js";
import { saveSession } from "./session.js";
import { buildSystemPrompt } from "./prompt.js";
import * as readline from "readline";
import { randomUUID } from "crypto";

// ─── Retry with exponential backoff ──────────────────────────

function isRetryable(error: any): boolean {
  const status = error?.status || error?.statusCode;
  if ([429, 503, 529].includes(status)) return true;
  if (error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT") return true;
  if (error?.message?.includes("overloaded")) return true;
  return false;
}

async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(signal);
    } catch (error: any) {
      if (signal?.aborted) throw error;
      if (attempt >= maxRetries || !isRetryable(error)) throw error;
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000) + Math.random() * 1000;
      const reason = error?.status ? `HTTP ${error.status}` : error?.code || "network error";
      printRetry(attempt + 1, maxRetries, reason);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ─── Model context windows ──────────────────────────────────

const MODEL_CONTEXT: Record<string, number> = {
  "claude-sonnet-4-20250514": 200000,
  "claude-haiku-4-20250414": 200000,
  "claude-opus-4-20250514": 200000,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
};

function getContextWindow(model: string): number {
  return MODEL_CONTEXT[model] || 200000;
}

// ─── Convert tools to OpenAI format ─────────────────────────

function toOpenAITools(): OpenAI.ChatCompletionTool[] {
  return toolDefinitions.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

// ─── Agent ───────────────────────────────────────────────────

interface AgentOptions {
  yolo?: boolean;
  model?: string;
  apiBase?: string;
  apiKey?: string;
  thinking?: boolean;
}

export class Agent {
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;
  private useOpenAI: boolean;
  private yolo: boolean;
  private thinking: boolean;
  private model: string;
  private systemPrompt: string;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private lastInputTokenCount = 0;
  private effectiveWindow: number;
  private sessionId: string;
  private sessionStartTime: string;

  // Abort support
  private abortController: AbortController | null = null;

  // Permission whitelist: paths confirmed in this session
  private confirmedPaths: Set<string> = new Set();

  // Separate message histories for each backend
  private anthropicMessages: Anthropic.MessageParam[] = [];
  private openaiMessages: OpenAI.ChatCompletionMessageParam[] = [];

  constructor(options: AgentOptions = {}) {
    this.yolo = options.yolo || false;
    this.thinking = options.thinking || false;
    this.model = options.model || "claude-sonnet-4-20250514";
    this.useOpenAI = !!options.apiBase;
    this.systemPrompt = buildSystemPrompt();
    this.effectiveWindow = getContextWindow(this.model) - 20000;
    this.sessionId = randomUUID().slice(0, 8);
    this.sessionStartTime = new Date().toISOString();

    if (this.useOpenAI) {
      this.openaiClient = new OpenAI({
        baseURL: options.apiBase,
        apiKey: options.apiKey,
      });
      this.openaiMessages.push({ role: "system", content: this.systemPrompt });
    } else {
      this.anthropicClient = new Anthropic({ apiKey: options.apiKey });
    }
  }

  abort() {
    this.abortController?.abort();
  }

  get isProcessing(): boolean {
    return this.abortController !== null;
  }

  getTokenUsage() {
    return { input: this.totalInputTokens, output: this.totalOutputTokens };
  }

  async chat(userMessage: string): Promise<void> {
    this.abortController = new AbortController();
    try {
      if (this.useOpenAI) {
        await this.chatOpenAI(userMessage);
      } else {
        await this.chatAnthropic(userMessage);
      }
    } finally {
      this.abortController = null;
    }
    printDivider();
    this.autoSave();
  }

  // ─── REPL commands ──────────────────────────────────────────

  clearHistory() {
    this.anthropicMessages = [];
    this.openaiMessages = [];
    if (this.useOpenAI) {
      this.openaiMessages.push({ role: "system", content: this.systemPrompt });
    }
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.lastInputTokenCount = 0;
    printInfo("Conversation cleared.");
  }

  showCost() {
    const costIn = (this.totalInputTokens / 1_000_000) * 3;
    const costOut = (this.totalOutputTokens / 1_000_000) * 15;
    const total = costIn + costOut;
    printInfo(
      `Tokens: ${this.totalInputTokens} in / ${this.totalOutputTokens} out\n  Estimated cost: $${total.toFixed(4)}`
    );
  }

  async compact() {
    await this.compactConversation();
  }

  // ─── Session restore ───────────────────────────────────────

  restoreSession(data: { anthropicMessages?: any[]; openaiMessages?: any[] }) {
    if (data.anthropicMessages) this.anthropicMessages = data.anthropicMessages;
    if (data.openaiMessages) this.openaiMessages = data.openaiMessages;
    printInfo(`Session restored (${this.getMessageCount()} messages).`);
  }

  private getMessageCount(): number {
    return this.useOpenAI ? this.openaiMessages.length : this.anthropicMessages.length;
  }

  private autoSave() {
    try {
      saveSession(this.sessionId, {
        metadata: {
          id: this.sessionId,
          model: this.model,
          cwd: process.cwd(),
          startTime: this.sessionStartTime,
          messageCount: this.getMessageCount(),
        },
        anthropicMessages: this.useOpenAI ? undefined : this.anthropicMessages,
        openaiMessages: this.useOpenAI ? this.openaiMessages : undefined,
      });
    } catch {}
  }

  // ─── Autocompact ───────────────────────────────────────────

  private async checkAndCompact(): Promise<void> {
    if (this.lastInputTokenCount > this.effectiveWindow * 0.85) {
      printInfo("Context window filling up, compacting conversation...");
      await this.compactConversation();
    }
  }

  private async compactConversation(): Promise<void> {
    if (this.useOpenAI) {
      await this.compactOpenAI();
    } else {
      await this.compactAnthropic();
    }
    printInfo("Conversation compacted.");
  }

  private async compactAnthropic(): Promise<void> {
    if (this.anthropicMessages.length < 4) return;
    const lastUserMsg = this.anthropicMessages[this.anthropicMessages.length - 1];
    const summaryReq: Anthropic.MessageParam[] = [
      {
        role: "user",
        content:
          "Summarize the conversation so far in a concise paragraph, preserving key decisions, file paths, and context needed to continue the work.",
      },
    ];
    const summaryResp = await this.anthropicClient!.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: "You are a conversation summarizer. Be concise but preserve important details.",
      messages: [
        ...this.anthropicMessages.slice(0, -1),
        ...summaryReq,
      ],
    });
    const summaryText =
      summaryResp.content[0]?.type === "text"
        ? summaryResp.content[0].text
        : "No summary available.";
    this.anthropicMessages = [
      { role: "user", content: `[Previous conversation summary]\n${summaryText}` },
      { role: "assistant", content: "Understood. I have the context from our previous conversation. How can I continue helping?" },
    ];
    if (lastUserMsg.role === "user") this.anthropicMessages.push(lastUserMsg);
    this.lastInputTokenCount = 0;
  }

  private async compactOpenAI(): Promise<void> {
    if (this.openaiMessages.length < 5) return;
    const systemMsg = this.openaiMessages[0];
    const lastUserMsg = this.openaiMessages[this.openaiMessages.length - 1];
    const summaryResp = await this.openaiClient!.chat.completions.create({
      model: this.model,
      max_tokens: 2048,
      messages: [
        { role: "system", content: "You are a conversation summarizer. Be concise but preserve important details." },
        ...this.openaiMessages.slice(1, -1),
        { role: "user", content: "Summarize the conversation so far in a concise paragraph, preserving key decisions, file paths, and context needed to continue the work." },
      ],
    });
    const summaryText = summaryResp.choices[0]?.message?.content || "No summary available.";
    this.openaiMessages = [
      systemMsg,
      { role: "user", content: `[Previous conversation summary]\n${summaryText}` },
      { role: "assistant", content: "Understood. I have the context from our previous conversation. How can I continue helping?" },
    ];
    if ((lastUserMsg as any).role === "user") this.openaiMessages.push(lastUserMsg);
    this.lastInputTokenCount = 0;
  }

  // ─── Anthropic backend ───────────────────────────────────────

  private async chatAnthropic(userMessage: string): Promise<void> {
    this.anthropicMessages.push({ role: "user", content: userMessage });

    while (true) {
      if (this.abortController?.signal.aborted) break;

      const response = await this.callAnthropicStream();
      this.totalInputTokens += response.usage.input_tokens;
      this.totalOutputTokens += response.usage.output_tokens;
      this.lastInputTokenCount = response.usage.input_tokens;

      const toolUses: Anthropic.ToolUseBlock[] = [];

      for (const block of response.content) {
        if (block.type === "tool_use") {
          toolUses.push(block);
        }
      }

      this.anthropicMessages.push({
        role: "assistant",
        content: response.content,
      });

      if (toolUses.length === 0) {
        printCost(this.totalInputTokens, this.totalOutputTokens);
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUses) {
        if (this.abortController?.signal.aborted) break;
        const input = toolUse.input as Record<string, any>;
        printToolCall(toolUse.name, input);

        // Permission check
        if (!this.yolo) {
          const confirmMsg = needsConfirmation(toolUse.name, input);
          if (confirmMsg && !this.confirmedPaths.has(confirmMsg)) {
            const confirmed = await this.confirmDangerous(confirmMsg);
            if (!confirmed) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: "User denied this action.",
              });
              continue;
            }
            this.confirmedPaths.add(confirmMsg);
          }
        }

        const result = await executeTool(toolUse.name, input);
        printToolResult(toolUse.name, result);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      this.anthropicMessages.push({ role: "user", content: toolResults });
      await this.checkAndCompact();
    }
  }

  private async callAnthropicStream(): Promise<Anthropic.Message> {
    return withRetry(async (signal) => {
      const createParams: any = {
        model: this.model,
        max_tokens: this.thinking ? 16000 : 8096,
        system: this.systemPrompt,
        tools: toolDefinitions,
        messages: this.anthropicMessages,
      };

      // Extended thinking support (Anthropic only)
      if (this.thinking) {
        createParams.thinking = { type: "enabled", budget_tokens: 10000 };
      }

      const stream = this.anthropicClient!.messages.stream(createParams, { signal });

      let firstText = true;
      stream.on("text", (text) => {
        if (firstText) { printAssistantText("\n"); firstText = false; }
        printAssistantText(text);
      });

      const finalMessage = await stream.finalMessage();

      // Filter out thinking blocks from content (don't store in history)
      if (this.thinking) {
        finalMessage.content = finalMessage.content.filter(
          (block: any) => block.type !== "thinking"
        );
      }

      return finalMessage;
    }, this.abortController?.signal);
  }

  // ─── OpenAI-compatible backend ───────────────────────────────

  private async chatOpenAI(userMessage: string): Promise<void> {
    this.openaiMessages.push({ role: "user", content: userMessage });

    while (true) {
      if (this.abortController?.signal.aborted) break;

      const response = await this.callOpenAIStream();

      // Track tokens
      if (response.usage) {
        this.totalInputTokens += response.usage.prompt_tokens;
        this.totalOutputTokens += response.usage.completion_tokens;
        this.lastInputTokenCount = response.usage.prompt_tokens;
      }

      const choice = response.choices[0];
      const message = choice.message;

      // Add assistant message to history
      this.openaiMessages.push(message);

      // If no tool calls, we're done
      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        printCost(this.totalInputTokens, this.totalOutputTokens);
        break;
      }

      // Execute tool calls
      for (const tc of toolCalls) {
        if (this.abortController?.signal.aborted) break;
        if (tc.type !== "function") continue;
        const fnName = tc.function.name;
        let input: Record<string, any>;
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = {};
        }

        printToolCall(fnName, input);

        // Permission check
        if (!this.yolo) {
          const confirmMsg = needsConfirmation(fnName, input);
          if (confirmMsg && !this.confirmedPaths.has(confirmMsg)) {
            const confirmed = await this.confirmDangerous(confirmMsg);
            if (!confirmed) {
              this.openaiMessages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: "User denied this action.",
              });
              continue;
            }
            this.confirmedPaths.add(confirmMsg);
          }
        }

        const result = await executeTool(fnName, input);
        printToolResult(fnName, result);

        this.openaiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      await this.checkAndCompact();
    }
  }

  private async callOpenAIStream(): Promise<OpenAI.ChatCompletion> {
    return withRetry(async (signal) => {
      const stream = await this.openaiClient!.chat.completions.create({
        model: this.model,
        max_tokens: 8096,
        tools: toOpenAITools(),
        messages: this.openaiMessages,
        stream: true,
        stream_options: { include_usage: true },
      }, { signal });

      // Accumulate the streamed response
      let content = "";
      let firstText = true;
      const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
      let finishReason = "";
      let usage: { prompt_tokens: number; completion_tokens: number } | undefined;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        // Usage comes in the final chunk (no delta)
        if (chunk.usage) {
          usage = {
            prompt_tokens: chunk.usage.prompt_tokens,
            completion_tokens: chunk.usage.completion_tokens,
          };
        }

        if (!delta) continue;

        // Stream text content
        if (delta.content) {
          if (firstText) { printAssistantText("\n"); firstText = false; }
          printAssistantText(delta.content);
          content += delta.content;
        }

        // Accumulate tool calls (arguments arrive in chunks)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCalls.get(tc.index);
            if (existing) {
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            } else {
              toolCalls.set(tc.index, {
                id: tc.id || "",
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "",
              });
            }
          }
        }

        if (chunk.choices[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }

      // Reconstruct ChatCompletion from streamed chunks
      const assembledToolCalls = toolCalls.size > 0
        ? Array.from(toolCalls.entries())
            .sort(([a], [b]) => a - b)
            .map(([idx, tc]) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            }))
        : undefined;

      return {
        id: "stream",
        object: "chat.completion",
        created: Date.now(),
        model: this.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant" as const,
              content: content || null,
              tool_calls: assembledToolCalls,
              refusal: null,
            },
            finish_reason: finishReason || "stop",
            logprobs: null,
          },
        ],
        usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      } as OpenAI.ChatCompletion;
    }, this.abortController?.signal);
  }

  // ─── Shared ──────────────────────────────────────────────────

  private async confirmDangerous(command: string): Promise<boolean> {
    printConfirmation(command);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question("  Allow? (y/n): ", (answer) => {
        rl.close();
        resolve(answer.toLowerCase().startsWith("y"));
      });
    });
  }
}
