import OpenAI from "openai";
import type { ToolDef } from "../tools/tools.js";
import { withRetry } from "../core/agent-retry.js";
import { stopSpinner, resetMarkdown, flushMarkdown, printRetry } from "../ui/index.js";
import type { CompressionPipeline } from "../core/compress.js";
import type { MessageHandler, StreamResult, BackendConfig, ToolResultEntry } from "./backend-types.js";

function toOpenAITools(tools: ToolDef[]): OpenAI.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema as Record<string, unknown>,
    },
  }));
}

export class OpenAIBackend implements MessageHandler {
  model: string;
  private client: OpenAI;
  private messages: OpenAI.ChatCompletionMessageParam[] = [];
  private systemPrompt: string;
  private tools: ToolDef[];
  private isSubAgent: boolean;
  private emitText: (text: string) => void;

  constructor(config: BackendConfig, isSubAgent: boolean, emitText: (text: string) => void) {
    this.model = config.model;
    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    });
    this.systemPrompt = config.systemPrompt;
    this.tools = config.tools;
    this.isSubAgent = isSubAgent;
    this.emitText = emitText;
    this.messages.push({ role: "system", content: this.systemPrompt });
  }

  // ─── MessageHandler: core ─────────────────────────────────

  getMessages(): unknown[] {
    return this.messages;
  }

  setMessages(msgs: unknown[]): void {
    this.messages = msgs as OpenAI.ChatCompletionMessageParam[];
  }

  clearMessages(): void {
    this.messages = [{ role: "system", content: this.systemPrompt }];
  }

  updateModel(model: string): void {
    this.model = model;
  }

  getBackendType(): "openai" {
    return "openai";
  }

  // ─── MessageHandler: semantic operations ──────────────────

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  addToolRound(result: StreamResult, toolResults: ToolResultEntry[]): void {
    // Assistant message with tool_calls array
    this.messages.push({
      role: "assistant",
      content: result.content || null,
      tool_calls: result.toolCalls.map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });
    // Each tool result as a separate message
    for (const tr of toolResults) {
      this.messages.push({
        role: "tool",
        tool_call_id: tr.toolCallId,
        content: tr.content,
      } as OpenAI.ChatCompletionToolMessageParam);
    }
  }

  runCompression(pipeline: CompressionPipeline, tokenCount: number): void {
    pipeline.runOpenAI(this.messages as any, tokenCount);
  }

  findToolUseById(_id: string): null {
    return null; // OpenAI uses separate tool messages; not needed
  }

  // ─── Conversation compaction ──────────────────────────────

  async compactConversation(compactModel: string): Promise<boolean> {
    if (this.messages.length < 5) return false;
    const systemMsg = this.messages[0];
    const lastUserMsg = this.messages[this.messages.length - 1];
    const summaryResp = await this.client.chat.completions.create({
      model: compactModel,
      max_tokens: 2048,
      messages: [
        { role: "system", content: "You are a conversation summarizer. Be concise but preserve important details." },
        ...this.messages.slice(1, -1),
        { role: "user", content: "Summarize the conversation so far in a concise paragraph, preserving key decisions, file paths, and context needed to continue the work." },
      ],
    });
    const summaryText = summaryResp.choices[0]?.message?.content || "No summary available.";
    this.messages = [
      systemMsg,
      { role: "user", content: `[Previous conversation summary]\n${summaryText}` },
      { role: "assistant", content: "Understood. I have the context from our previous conversation. How can I continue helping?" },
    ];
    if ((lastUserMsg as any).role === "user") this.messages.push(lastUserMsg);
    return true;
  }

  // ─── Streaming ────────────────────────────────────────────

  async stream(signal?: AbortSignal): Promise<StreamResult> {
    return withRetry(async (retrySignal) => {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 16384,
        tools: toOpenAITools(this.tools),
        messages: this.messages,
        stream: true,
        stream_options: { include_usage: true },
      }, { signal: retrySignal });

      let content = "";
      const toolCalls: StreamResult["toolCalls"] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let firstText = true;

      if (!this.isSubAgent) resetMarkdown();

      const pendingTools: Map<number, { id: string; name: string; arguments: string }> = new Map();

      for await (const chunk of stream) {
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }

        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          if (firstText) { if (!this.isSubAgent) stopSpinner(); this.emitText("\n"); firstText = false; }
          this.emitText(delta.content);
          content += delta.content;
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = pendingTools.get(tc.index);
            if (existing) {
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            } else {
              pendingTools.set(tc.index, {
                id: tc.id || "",
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "",
              });
            }
          }
        }
      }

      if (!this.isSubAgent) flushMarkdown();

      for (const [, tc] of pendingTools) {
        toolCalls.push(tc);
      }

      return {
        content,
        toolCalls,
        usage: { inputTokens, outputTokens },
      };
    }, {
      signal,
      onRetry: ({ attempt, maxRetries, reason }) => printRetry(attempt, maxRetries, reason),
    });
  }
}
