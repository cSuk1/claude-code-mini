import type { ToolDef } from "../tools/tools.js";
import type { CompressionPipeline } from "../core/compress.js";

export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "done" };

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
  /** Get raw message array (for session save/compression) */
  getMessages(): unknown[];
  /** Replace entire message array (session restore) */
  setMessages(msgs: unknown[]): void;
  /** Clear all messages (reset conversation) */
  clearMessages(): void;
  /** Stream a response from the model */
  stream(signal?: AbortSignal): Promise<StreamResult>;
  /** Summarize conversation to reduce context size */
  compactConversation(compactModel: string): Promise<boolean>;
  /** Update the model used for subsequent API calls */
  updateModel(model: string): void;

  // ─── Semantic message operations ────────────────────────
  /** Add a user text message */
  addUserMessage(content: string): void;
  /** Add an assistant response + tool results in the correct backend format */
  addToolRound(result: StreamResult, toolResults: ToolResultEntry[]): void;
  /** Run the compression pipeline in the correct backend format */
  runCompression(pipeline: CompressionPipeline, tokenCount: number): void;
  /** Find a tool_use block by ID in assistant messages (Anthropic only, OpenAI returns null) */
  findToolUseById(id: string): { name: string; input: Record<string, unknown> } | null;
  /** Backend identifier for session save/restore branching */
  getBackendType(): "anthropic" | "openai";
}
