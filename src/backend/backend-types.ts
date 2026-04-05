import type { ToolDef } from "../tools/tools.js";
import type { CompressionPipeline } from "../core/compress.js";

export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "done" };

export interface StreamChunk {
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  usage?: { inputTokens: number; outputTokens: number };
  done?: boolean;
}

export interface StreamResult {
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  usage: { inputTokens: number; outputTokens: number };
  /** Anthropic: original content blocks (text + tool_use) for assistant message history */
  rawAssistantContent?: unknown[];
}

export interface BackendConfig {
  model: string;
  systemPrompt: string;
  tools: ToolDef[];
  thinking?: boolean;
  apiKey?: string;
  baseURL?: string;
}

/** Backend-agnostic tool result from Agent's tool execution */
export interface ToolResultEntry {
  toolCallId: string;
  content: string;
}

export interface MessageHandler {
  getMessages(): unknown[];
  setMessages(msgs: unknown[]): void;
  clearMessages(): void;
  stream(signal?: AbortSignal): Promise<StreamResult>;
  streamChunk(signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown>;
  compactConversation(compactModel: string): Promise<boolean>;
  updateModel(model: string): void;
  addUserMessage(content: string): void;
  addToolRound(result: StreamResult, toolResults: ToolResultEntry[]): void;
  runCompression(pipeline: CompressionPipeline, tokenCount: number): void;
  findToolUseById(id: string): { name: string; input: Record<string, unknown> } | null;
  getBackendType(): "anthropic" | "openai";
}
