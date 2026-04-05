import Anthropic from "@anthropic-ai/sdk";
import type { ToolDef } from "../tools/tools.js";
import { getMaxOutputTokens, modelSupportsThinking, modelSupportsAdaptiveThinking } from "../core/agent-model.js";
import { withRetry } from "../core/agent-retry.js";
import type { CompressionPipeline } from "../core/compress.js";
import type { MessageHandler, StreamResult, BackendConfig, ToolResultEntry, StreamChunk } from "./backend-types.js";

export class AnthropicBackend implements MessageHandler {
  model: string;
  private client: Anthropic;
  private messages: Anthropic.MessageParam[] = [];
  private systemPrompt: string;
  private tools: ToolDef[];
  private thinking: boolean;
  private isSubAgent: boolean;
  private emitText: (text: string) => void;

  constructor(config: BackendConfig, isSubAgent: boolean, emitText: (text: string) => void) {
    this.model = config.model;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    this.systemPrompt = config.systemPrompt;
    this.tools = config.tools;
    this.thinking = config.thinking || false;
    this.isSubAgent = isSubAgent;
    this.emitText = emitText;
  }

  // ─── MessageHandler: core ─────────────────────────────────

  getMessages(): unknown[] {
    return this.messages;
  }

  setMessages(msgs: unknown[]): void {
    this.messages = msgs as Anthropic.MessageParam[];
  }

  clearMessages(): void {
    this.messages = [];
  }

  updateModel(model: string): void {
    this.model = model;
  }

  getBackendType(): "anthropic" {
    return "anthropic";
  }

  // ─── MessageHandler: semantic operations ──────────────────

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  addToolRound(result: StreamResult, toolResults: ToolResultEntry[]): void {
    // Assistant message with full content blocks (text + tool_use)
    this.messages.push({
      role: "assistant",
      content: (result.rawAssistantContent as Anthropic.ContentBlock[])
        || [{ type: "text", text: result.content }],
    });
    // User message wrapping all tool results
    this.messages.push({
      role: "user",
      content: toolResults.map(tr => ({
        type: "tool_result" as const,
        tool_use_id: tr.toolCallId,
        content: tr.content,
      })),
    });
  }

  runCompression(pipeline: CompressionPipeline, tokenCount: number): void {
    pipeline.runAnthropic(this.messages as any, tokenCount);
  }

  findToolUseById(id: string): { name: string; input: Record<string, unknown> } | null {
    for (const msg of this.messages) {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const block of msg.content as any[]) {
        if (block.type === "tool_use" && block.id === id) {
          return { name: block.name, input: block.input };
        }
      }
    }
    return null;
  }

  // ─── Conversation compaction ──────────────────────────────

  async compactConversation(compactModel: string): Promise<boolean> {
    if (this.messages.length < 4) return false;
    const lastUserMsg = this.messages[this.messages.length - 1];
    const summaryResp = await this.client.messages.create({
      model: compactModel,
      max_tokens: 2048,
      system: "You are a conversation summarizer. Be concise but preserve important details.",
      messages: [
        ...this.messages.slice(0, -1),
        {
          role: "user",
          content: "Summarize the conversation so far in a concise paragraph, preserving key decisions, file paths, and context needed to continue the work.",
        },
      ],
    });
    const summaryText =
      summaryResp.content[0]?.type === "text"
        ? summaryResp.content[0].text
        : "No summary available.";
    this.messages = [
      { role: "user", content: `[Previous conversation summary]\n${summaryText}` },
      { role: "assistant", content: "Understood. I have the context from our previous conversation. How can I continue helping?" },
    ];
    if (lastUserMsg.role === "user") this.messages.push(lastUserMsg);
    return true;
  }

  // ─── Streaming ────────────────────────────────────────────

  private get thinkingMode(): "adaptive" | "enabled" | "disabled" {
    if (!this.thinking) return "disabled";
    if (!modelSupportsThinking(this.model)) return "disabled";
    if (modelSupportsAdaptiveThinking(this.model)) return "adaptive";
    return "enabled";
  }

  async stream(signal?: AbortSignal): Promise<StreamResult> {
    let content = "";
    let toolCalls: StreamResult["toolCalls"] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let rawAssistantContent: any[] = [];

    for await (const chunk of this.streamChunk(signal)) {
      if (chunk.content) {
        content += chunk.content;
        this.emitText(chunk.content);
      }
      if (chunk.toolCall) toolCalls.push(chunk.toolCall);
      if (chunk.usage) {
        inputTokens = chunk.usage.inputTokens;
        outputTokens = chunk.usage.outputTokens;
      }
    }

    return { content, toolCalls, usage: { inputTokens, outputTokens }, rawAssistantContent };
  }

  async *streamChunk(signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    const maxOutput = getMaxOutputTokens(this.model);
    const createParams: any = {
      model: this.model,
      max_tokens: this.thinkingMode !== "disabled" ? maxOutput : 16384,
      system: this.systemPrompt,
      tools: this.tools,
      messages: this.messages,
    };

    if (this.thinkingMode === "adaptive" || this.thinkingMode === "enabled") {
      createParams.thinking = { type: "enabled", budget_tokens: maxOutput - 1 };
    }

    const chunks: StreamChunk[] = [];
    const contentParts: string[] = [];

    const stream = this.client.messages.stream(createParams, { signal });

    stream.on("text", (text: string) => {
      chunks.push({ content: text });
      contentParts.push(text);
    });

    if (this.thinkingMode !== "disabled") {
      stream.on("streamEvent" as any, (event: any) => {
        if (event.type === "content_block_start" && event.content_block?.type === "thinking") {
          chunks.push({ content: "\n[thinking] " });
          contentParts.push("[thinking] ");
        } else if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") {
          chunks.push({ content: event.delta.thinking });
          contentParts.push(event.delta.thinking);
        } else if (event.type === "content_block_stop" && event.content_block?.type === "thinking") {
          chunks.push({ content: "\n" });
          contentParts.push("\n");
        }
      });
    }

    const finalMessage = await stream.finalMessage();
    const contentBlocks = finalMessage.content.filter((block: any) => block.type !== "thinking");

    for (const block of contentBlocks) {
      if (block.type === "tool_use") {
        chunks.push({
          toolCall: {
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    chunks.push({
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      },
    });

    chunks.push({ done: true });

    for (const chunk of chunks) {
      yield chunk;
    }
  }
}
