import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import chalk from "chalk";
import { toolDefinitions, executeTool, checkPermission, savePermissionRule, generatePermissionRule, type ToolDef, type PermissionMode } from "../tools/tools.js";
import { getContextWindow, isInternalModel, modelSupportsAdaptiveThinking, modelSupportsThinking, getMaxOutputTokens } from "./agent-model.js";
import { withRetry } from "./agent-retry.js";
import {
  KEEP_RECENT_RESULTS,
  MICROCOMPACT_IDLE_MS,
  OLD_RESULT_PLACEHOLDER,
  SNIPPABLE_TOOLS,
  SNIP_PLACEHOLDER,
  SNIP_THRESHOLD,
} from "./agent-compression.js";
import {
  printAssistantText,
  printToolCall,
  printToolResult,
  printError,
  printConfirmation,
  printDivider,
  printRetry,
  printInfo,
  printSubAgentStart,
  printSubAgentEnd,
  startSpinner,
  stopSpinner,
  flushMarkdown,
  resetMarkdown,
  showMenu,
} from "../ui/ui.js";
import { saveSession } from "../storage/session.js";
import { buildSystemPrompt, loadPlanModePrompt } from "./prompt.js";
import { getSubAgentConfig, BUILTIN_AGENT_TYPES, type SubAgentType } from "../extensions/subagent.js";

import { getModelForTier, resolveSubAgentModel } from "./model-tiers.js";
import { randomUUID } from "crypto";

// ─── OpenAI tool format adapter ─────────────────────────────

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

// ─── Agent ───────────────────────────────────────────────────

interface AgentOptions {
  permissionMode?: PermissionMode;
  yolo?: boolean;             // Legacy alias for bypassPermissions
  model?: string;
  apiBase?: string;           // OpenAI-compatible base URL
  anthropicBaseURL?: string;  // Anthropic base URL (e.g. proxy)
  apiKey?: string;
  thinking?: boolean;
  maxTurns?: number;          // Budget: max agentic turns
  confirmFn?: (toolName: string, input: Record<string, any>) => Promise<"allow" | "deny">;
  // Sub-agent options
  customSystemPrompt?: string;
  customTools?: ToolDef[];
  isSubAgent?: boolean;
}

export class Agent {
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;
  private useOpenAI: boolean;
  private permissionMode: PermissionMode;
  private thinking: boolean;
  private thinkingMode: "adaptive" | "enabled" | "disabled";
  private _model: string;
  private systemPrompt: string;
  private tools: ToolDef[];
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private lastInputTokenCount = 0;
  private effectiveWindow: number;
  private sessionId: string;
  private sessionStartTime: string;
  private isSubAgent: boolean;

  // Budget control
  private maxTurns?: number;
  private currentTurns = 0;

  // Multi-tier compression state
  private lastApiCallTime = 0;

  // Abort support
  private abortController: AbortController | null = null;

  // Permission whitelist: paths confirmed in this session
  private confirmedPaths: Set<string> = new Set();

  // External confirmation callback (avoids creating a second readline on stdin)
  private confirmFn?: (toolName: string, input: Record<string, any>) => Promise<"allow" | "deny">;

  // Sub-agent output buffer (captures text instead of printing)
  private outputBuffer: string[] | null = null;

  // Separate message histories for each backend
  private anthropicMessages: Anthropic.MessageParam[] = [];
  private openaiMessages: OpenAI.ChatCompletionMessageParam[] = [];

  get model(): string { return this._model; }

  constructor(options: AgentOptions = {}) {
    // Permission mode: explicit mode > yolo legacy > default
    this.permissionMode = options.permissionMode
      || (options.yolo ? "bypassPermissions" : "default");
    this.thinking = options.thinking || false;
    // Model selection: explicit model > pro tier default
    this._model = options.model || getModelForTier("pro");
    this.thinkingMode = this.resolveThinkingMode();
    this.useOpenAI = !!options.apiBase;
    this.isSubAgent = options.isSubAgent || false;
    this.tools = options.customTools || toolDefinitions;
    this.maxTurns = options.maxTurns;
    this.confirmFn = options.confirmFn;
    this.effectiveWindow = getContextWindow(this._model) - 20000;
    this.sessionId = randomUUID().slice(0, 8);
    this.sessionStartTime = new Date().toISOString();

    // Build system prompt (with plan mode injection if needed)
   let sysPrompt = options.customSystemPrompt || buildSystemPrompt();
   if (this.permissionMode === "plan") {
      sysPrompt += "\n\n" + loadPlanModePrompt();
   }
   this.systemPrompt = sysPrompt;

    if (this.useOpenAI) {
      this.openaiClient = new OpenAI({
        baseURL: options.apiBase,
        apiKey: options.apiKey,
      });
      this.openaiMessages.push({ role: "system", content: this.systemPrompt });
    } else {
      this.anthropicClient = new Anthropic({
        apiKey: options.apiKey,
        ...(options.anthropicBaseURL ? { baseURL: options.anthropicBaseURL } : {}),
      });
    }
  }

  private resolveThinkingMode(): "adaptive" | "enabled" | "disabled" {
    if (!this.thinking) return "disabled";
    if (!modelSupportsThinking(this.model)) return "disabled";
    if (modelSupportsAdaptiveThinking(this.model)) return "adaptive";
    return "enabled";
  }

  abort() {
    this.abortController?.abort();
  }

  /**
   * Dynamically switch the model at runtime.
   * Updates context window, thinking mode, and returns switch result.
   */
  switchModel(newModel: string): { model: string; known: boolean } {
    if (newModel === this._model) return { model: this._model, known: true };
    // Always apply the switch — warn if model is unrecognized but don't block
    const known = isInternalModel(newModel);
    this._model = newModel;
    this.effectiveWindow = getContextWindow(newModel) - 20000;
    this.thinkingMode = this.resolveThinkingMode();
    return { model: this._model, known };
  }

  get isProcessing(): boolean {
    return this.abortController !== null;
  }

  setConfirmFn(fn: (toolName: string, input: Record<string, any>) => Promise<"allow" | "deny">) {
    this.confirmFn = fn;
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
    if (!this.isSubAgent) {
      printDivider();
      this.autoSave();
    }
  }

  // ─── Sub-agent entry point ────────────────────────────────

  async runOnce(prompt: string): Promise<{ text: string; tokens: { input: number; output: number } }> {
    this.outputBuffer = [];
    const prevInput = this.totalInputTokens;
    const prevOutput = this.totalOutputTokens;
    await this.chat(prompt);
    const text = this.outputBuffer.join("");
    this.outputBuffer = null;
    return {
      text,
      tokens: {
        input: this.totalInputTokens - prevInput,
        output: this.totalOutputTokens - prevOutput,
      },
    };
  }

  // ─── Output helper (captures if sub-agent) ────────────────

  private emitText(text: string): void {
    if (this.outputBuffer) {
      this.outputBuffer.push(text);
    } else {
      printAssistantText(text);
    }
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



  private checkBudget(): { exceeded: boolean; reason?: string } {
    if (this.maxTurns !== undefined && this.currentTurns >= this.maxTurns) {
      return { exceeded: true, reason: `Turn limit reached (${this.currentTurns} >= ${this.maxTurns})` };
    }
    return { exceeded: false };
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
    // Use compact tier model for summarization (cheaper than main model)
    const compactModel = resolveSubAgentModel(BUILTIN_AGENT_TYPES.COMPACT);
    const summaryResp = await this.anthropicClient!.messages.create({
      model: compactModel.model,
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
    // Use compact tier model for summarization (cheaper than main model)
    const compactModel = resolveSubAgentModel(BUILTIN_AGENT_TYPES.COMPACT);
    const summaryResp = await this.openaiClient!.chat.completions.create({
      model: compactModel.model,
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

  // ─── Multi-tier compression pipeline ──────────────────────
  // Mirrors Claude Code's 4-layer: budget → snip → microcompact → auto-compact
  // Tiers 1-3 are zero-API-cost, operating on the local message array.

  private runCompressionPipeline(): void {
    if (this.useOpenAI) {
      this.budgetToolResultsOpenAI();
      this.snipStaleResultsOpenAI();
      this.microcompactOpenAI();
    } else {
      this.budgetToolResultsAnthropic();
      this.snipStaleResultsAnthropic();
      this.microcompactAnthropic();
    }
  }

  // Tier 1: Budget tool results — dynamically shrink large results as context fills
  private budgetToolResultsAnthropic(): void {
    const utilization = this.lastInputTokenCount / this.effectiveWindow;
    if (utilization < 0.5) return;
    const budget = utilization > 0.7 ? 15000 : 30000;

    for (const msg of this.anthropicMessages) {
      if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
      for (let i = 0; i < msg.content.length; i++) {
        const block = msg.content[i] as any;
        if (block.type === "tool_result" && typeof block.content === "string" && block.content.length > budget) {
          const keepEach = Math.floor((budget - 80) / 2);
          block.content = block.content.slice(0, keepEach) +
            `\n\n[... budgeted: ${block.content.length - keepEach * 2} chars truncated ...]\n\n` +
            block.content.slice(-keepEach);
        }
      }
    }
  }

  private budgetToolResultsOpenAI(): void {
    const utilization = this.lastInputTokenCount / this.effectiveWindow;
    if (utilization < 0.5) return;
    const budget = utilization > 0.7 ? 15000 : 30000;

    for (const msg of this.openaiMessages) {
      if ((msg as any).role === "tool" && typeof (msg as any).content === "string") {
        const content = (msg as any).content as string;
        if (content.length > budget) {
          const keepEach = Math.floor((budget - 80) / 2);
          (msg as any).content = content.slice(0, keepEach) +
            `\n\n[... budgeted: ${content.length - keepEach * 2} chars truncated ...]\n\n` +
            content.slice(-keepEach);
        }
      }
    }
  }

  // Tier 2: Snip stale results — replace old/duplicate tool results with placeholder
  private snipStaleResultsAnthropic(): void {
    const utilization = this.lastInputTokenCount / this.effectiveWindow;
    if (utilization < SNIP_THRESHOLD) return;

    // Collect all tool_result blocks with metadata
    const results: { msgIdx: number; blockIdx: number; toolName: string; filePath?: string }[] = [];
    for (let mi = 0; mi < this.anthropicMessages.length; mi++) {
      const msg = this.anthropicMessages[mi];
      if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
      for (let bi = 0; bi < msg.content.length; bi++) {
        const block = msg.content[bi] as any;
        if (block.type === "tool_result" && typeof block.content === "string" && block.content !== SNIP_PLACEHOLDER) {
          // Find the corresponding tool_use to get tool name and input
          const toolUseId = block.tool_use_id;
          const toolInfo = this.findToolUseById(toolUseId);
          if (toolInfo && SNIPPABLE_TOOLS.has(toolInfo.name)) {
            results.push({ msgIdx: mi, blockIdx: bi, toolName: toolInfo.name, filePath: toolInfo.input?.file_path });
          }
        }
      }
    }

    if (results.length <= KEEP_RECENT_RESULTS) return;

    // Strategy: snip duplicates and old results, keep recent N
    const toSnip = new Set<number>();
    const seenFiles = new Map<string, number[]>(); // filePath → indices

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.toolName === "read_file" && r.filePath) {
        const existing = seenFiles.get(r.filePath) || [];
        existing.push(i);
        seenFiles.set(r.filePath, existing);
      }
    }

    // Snip earlier reads of same file
    for (const indices of seenFiles.values()) {
      if (indices.length > 1) {
        for (let j = 0; j < indices.length - 1; j++) toSnip.add(indices[j]);
      }
    }

    // Snip oldest results beyond keep-recent threshold
    const snipBefore = results.length - KEEP_RECENT_RESULTS;
    for (let i = 0; i < snipBefore; i++) toSnip.add(i);

    for (const idx of toSnip) {
      const r = results[idx];
      const block = (this.anthropicMessages[r.msgIdx].content as any[])[r.blockIdx];
      block.content = SNIP_PLACEHOLDER;
    }
  }

  private snipStaleResultsOpenAI(): void {
    const utilization = this.lastInputTokenCount / this.effectiveWindow;
    if (utilization < SNIP_THRESHOLD) return;

    // Collect tool messages
    const toolMsgs: { idx: number; toolCallId: string }[] = [];
    for (let i = 0; i < this.openaiMessages.length; i++) {
      const msg = this.openaiMessages[i] as any;
      if (msg.role === "tool" && typeof msg.content === "string" && msg.content !== SNIP_PLACEHOLDER) {
        toolMsgs.push({ idx: i, toolCallId: msg.tool_call_id });
      }
    }

    if (toolMsgs.length <= KEEP_RECENT_RESULTS) return;

    // Snip all but the most recent N
    const snipCount = toolMsgs.length - KEEP_RECENT_RESULTS;
    for (let i = 0; i < snipCount; i++) {
      (this.openaiMessages[toolMsgs[i].idx] as any).content = SNIP_PLACEHOLDER;
    }
  }

  // Tier 3: Microcompact — aggressively clear old results when prompt cache is cold
  private microcompactAnthropic(): void {
    if (!this.lastApiCallTime || (Date.now() - this.lastApiCallTime) < MICROCOMPACT_IDLE_MS) return;

    // Collect ALL tool_results across messages, clear all but recent N
    const allResults: { msgIdx: number; blockIdx: number }[] = [];
    for (let mi = 0; mi < this.anthropicMessages.length; mi++) {
      const msg = this.anthropicMessages[mi];
      if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
      for (let bi = 0; bi < msg.content.length; bi++) {
        const block = msg.content[bi] as any;
        if (block.type === "tool_result" && typeof block.content === "string" &&
            block.content !== SNIP_PLACEHOLDER && block.content !== OLD_RESULT_PLACEHOLDER) {
          allResults.push({ msgIdx: mi, blockIdx: bi });
        }
      }
    }

    const clearCount = allResults.length - KEEP_RECENT_RESULTS;
    for (let i = 0; i < clearCount && i < allResults.length; i++) {
      const r = allResults[i];
      (this.anthropicMessages[r.msgIdx].content as any[])[r.blockIdx].content = OLD_RESULT_PLACEHOLDER;
    }
  }

  // when prompt cache is cold, clear all but recent N tool results
  private microcompactOpenAI(): void {
    if (!this.lastApiCallTime || (Date.now() - this.lastApiCallTime) < MICROCOMPACT_IDLE_MS) return;

    const toolMsgs: number[] = [];
    for (let i = 0; i < this.openaiMessages.length; i++) {
      const msg = this.openaiMessages[i] as any;
      if (msg.role === "tool" && typeof msg.content === "string" &&
          msg.content !== SNIP_PLACEHOLDER && msg.content !== OLD_RESULT_PLACEHOLDER) {
        toolMsgs.push(i);
      }
    }

    const clearCount = toolMsgs.length - KEEP_RECENT_RESULTS;
    for (let i = 0; i < clearCount && i < toolMsgs.length; i++) {
      (this.openaiMessages[toolMsgs[i]] as any).content = OLD_RESULT_PLACEHOLDER;
    }
  }

  // Helper: find a tool_use block by its ID in assistant messages
  private findToolUseById(toolUseId: string): { name: string; input: any } | null {
    for (const msg of this.anthropicMessages) {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const block of msg.content as any[]) {
        if (block.type === "tool_use" && block.id === toolUseId) {
          return { name: block.name, input: block.input };
        }
      }
    }
    return null;
  }

  // ─── Execute tool (handles agent tool internally) ─────────

  private async executeToolCall(
    name: string,
    input: Record<string, any>
  ): Promise<string> {
    if (name === "agent") return this.executeAgentTool(input);
    if (name === "skill") return this.executeSkillTool(input);
    return executeTool(name, input);
  }

  // ─── Skill fork mode ─────────────────────────────────────

  private async executeSkillTool(input: Record<string, any>): Promise<string> {
    const { executeSkill } = await import("../extensions/skills.js");
    const result = executeSkill(input.skill_name, input.args || "");
    if (!result) return `Unknown skill: ${input.skill_name}`;

    if (result.context === "fork") {
      // Fork mode: run in isolated sub-agent
      const tools = result.allowedTools
        ? this.tools.filter(t => result.allowedTools!.includes(t.name))
        : this.tools.filter(t => t.name !== "agent");

      // Model routing: skill frontmatter `model` > default lite tier
      const routing = resolveSubAgentModel(BUILTIN_AGENT_TYPES.EXPLORE, result.model);

      printSubAgentStart("skill-fork", `${input.skill_name} [${routing.tier}:${routing.model}]`);
      const subAgent = new Agent({
        model: routing.model,
        apiBase: this.useOpenAI ? this.openaiClient?.baseURL : undefined,
        customSystemPrompt: result.prompt,
        customTools: tools,
        isSubAgent: true,
        permissionMode: "bypassPermissions",
      });

      try {
        const subResult = await subAgent.runOnce(input.args || "Execute this skill task.");
        this.totalInputTokens += subResult.tokens.input;
        this.totalOutputTokens += subResult.tokens.output;
        printSubAgentEnd("skill-fork", input.skill_name);
        return subResult.text || "(Skill produced no output)";
      } catch (e: any) {
        printSubAgentEnd("skill-fork", input.skill_name);
        return `Skill fork error: ${e.message}`;
      }
    }

    // Inline mode: return prompt for injection into conversation
    return `[Skill "${input.skill_name}" activated]\n\n${result.prompt}`;
  }

  private async executeAgentTool(input: Record<string, any>): Promise<string> {
    const type = (input.type || "general") as SubAgentType;
    const description = input.description || "sub-agent task";
    const prompt = input.prompt || "";
    const explicitModel = input.model as string | undefined;

    const config = getSubAgentConfig(type);

    // Model priority: tool call explicit model > custom agent frontmatter model > tier routing
    const routing = resolveSubAgentModel(type, explicitModel || config.model);

    printSubAgentStart(type, `${description} [${routing.tier}:${routing.model}]`);

    const subAgent = new Agent({
      apiKey: this.anthropicClient
        ? undefined  // Anthropic SDK reads from env
        : undefined,
      apiBase: this.useOpenAI ? this.openaiClient?.baseURL : undefined,
      model: routing.model,
      customSystemPrompt: config.systemPrompt,
      customTools: config.tools,
      isSubAgent: true,
      permissionMode: "bypassPermissions",
    });

    try {
      const result = await subAgent.runOnce(prompt);
      // Add sub-agent token usage to parent
      this.totalInputTokens += result.tokens.input;
      this.totalOutputTokens += result.tokens.output;
      printSubAgentEnd(type, description);
      return result.text || "(Sub-agent produced no output)";
    } catch (e: any) {
      printSubAgentEnd(type, description);
      return `Sub-agent error: ${e.message}`;
    }
  }

  // ─── Anthropic backend ───────────────────────────────────────

  private async chatAnthropic(userMessage: string): Promise<void> {
    this.anthropicMessages.push({ role: "user", content: userMessage });

    while (true) {
      if (this.abortController?.signal.aborted) break;

      // Run compression pipeline before API call (tiers 1-3 are zero-cost)
      this.runCompressionPipeline();

      if (!this.isSubAgent) startSpinner();
      let response: Anthropic.Message;
      try {
        response = await this.callAnthropicStream();
      } catch (e) {
        if (!this.isSubAgent) stopSpinner();
        throw e;
      }
      if (!this.isSubAgent) stopSpinner();
      this.lastApiCallTime = Date.now();
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
        if (!this.isSubAgent) {
          flushMarkdown();
        }
        break;
      }

      // Budget check after each turn
      this.currentTurns++;
      const budget = this.checkBudget();
      if (budget.exceeded) {
        printInfo(`Budget exceeded: ${budget.reason}`);
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUses) {
        if (this.abortController?.signal.aborted) break;
        const input = toolUse.input as Record<string, any>;
        printToolCall(toolUse.name, input);

        // Permission check (mode-aware)
        const perm = checkPermission(toolUse.name, input, this.permissionMode);
        if (perm.action === "deny") {
          printInfo(`Denied: ${perm.message}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Action denied: ${perm.message}`,
          });
          continue;
        }
        if (perm.action === "confirm" && perm.message && !this.confirmedPaths.has(perm.message)) {
          const choice = await this.confirmDangerous(toolUse.name, input, perm.message);
          if (choice === "deny") {
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: "User denied this action.",
            });
            continue;
          }
          this.confirmedPaths.add(perm.message);
        }

        const result = await this.executeToolCall(toolUse.name, input);
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
      const maxOutput = getMaxOutputTokens(this.model);
      const createParams: any = {
        model: this.model,
        max_tokens: this.thinkingMode !== "disabled" ? maxOutput : 16384,
        system: this.systemPrompt,
        tools: this.tools,
        messages: this.anthropicMessages,
      };

      // Extended thinking support (Anthropic only)
      // Mirrors Claude Code: adaptive for 4.6 models, enabled with budget for older
      if (this.thinkingMode === "adaptive") {
        createParams.thinking = { type: "enabled", budget_tokens: maxOutput - 1 };
      } else if (this.thinkingMode === "enabled") {
        createParams.thinking = { type: "enabled", budget_tokens: maxOutput - 1 };
      }

      const stream = this.anthropicClient!.messages.stream(createParams, { signal });

      // Stream text content (SDK high-level event)
      let firstText = true;
      if (!this.isSubAgent) resetMarkdown();
      stream.on("text", (text: string) => {
        if (firstText) { stopSpinner(); this.emitText("\n"); firstText = false; }
        this.emitText(text);
      });

      // Stream thinking content if enabled (SDK high-level event)
      if (this.thinkingMode !== "disabled") {
        let inThinking = false;
        stream.on("streamEvent" as any, (event: any) => {
          if (event.type === "content_block_start" && event.content_block?.type === "thinking") {
            inThinking = true;
            stopSpinner();
            this.emitText("\n" + chalk.dim("  [thinking] "));
          } else if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta" && inThinking) {
            this.emitText(chalk.dim(event.delta.thinking));
          } else if (event.type === "content_block_stop" && inThinking) {
            this.emitText("\n");
            inThinking = false;
          }
        });
      }

      const finalMessage = await stream.finalMessage();
      if (!this.isSubAgent) flushMarkdown();

      // Filter out thinking blocks from stored history
      // (Claude Code preserves redacted blocks, but for simplicity we strip them)
      finalMessage.content = finalMessage.content.filter(
        (block: any) => block.type !== "thinking"
      );

      return finalMessage;
    }, {
      signal: this.abortController?.signal,
      onRetry: ({ attempt, maxRetries, reason }) => printRetry(attempt, maxRetries, reason),
    });
  }

  // ─── OpenAI-compatible backend ───────────────────────────────

  private async chatOpenAI(userMessage: string): Promise<void> {
    this.openaiMessages.push({ role: "user", content: userMessage });

    while (true) {
      if (this.abortController?.signal.aborted) break;

      // Run compression pipeline before API call
      this.runCompressionPipeline();

      if (!this.isSubAgent) startSpinner();
      let response: OpenAI.ChatCompletion;
      try {
        response = await this.callOpenAIStream();
      } catch (e) {
        if (!this.isSubAgent) stopSpinner();
        throw e;
      }
      if (!this.isSubAgent) stopSpinner();
      this.lastApiCallTime = Date.now();

      // Track tokens
      if (response.usage) {
        this.totalInputTokens += response.usage.prompt_tokens;
        this.totalOutputTokens += response.usage.completion_tokens;
        this.lastInputTokenCount = response.usage.prompt_tokens;
      }

      const choice = response.choices?.[0];
      if (!choice) break;
      const message = choice.message;

      // Add assistant message to history
      this.openaiMessages.push(message);

      // If no tool calls, we're done
      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        if (!this.isSubAgent) {
          flushMarkdown();
        }
        break;
      }

      // Budget check after each turn
      this.currentTurns++;
      const budget = this.checkBudget();
      if (budget.exceeded) {
        printInfo(`Budget exceeded: ${budget.reason}`);
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

        // Permission check (mode-aware)
        const perm = checkPermission(fnName, input, this.permissionMode);
        if (perm.action === "deny") {
          printInfo(`Denied: ${perm.message}`);
          this.openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Action denied: ${perm.message}`,
          });
          continue;
        }
        if (perm.action === "confirm" && perm.message && !this.confirmedPaths.has(perm.message)) {
          const choice = await this.confirmDangerous(fnName, input, perm.message);
          if (choice === "deny") {
            this.openaiMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "User denied this action.",
            });
            continue;
          }
          this.confirmedPaths.add(perm.message);
        }

        const result = await this.executeToolCall(fnName, input);
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
        max_tokens: 16384,
        tools: toOpenAITools(this.tools),
        messages: this.openaiMessages,
        stream: true,
        stream_options: { include_usage: true },
      }, { signal });

      // Accumulate the streamed response
      let content = "";
      let firstText = true;
      if (!this.isSubAgent) resetMarkdown();
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
          if (firstText) { stopSpinner(); this.emitText("\n"); firstText = false; }
          this.emitText(delta.content);
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

      if (!this.isSubAgent) flushMarkdown();

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
    }, {
      signal: this.abortController?.signal,
      onRetry: ({ attempt, maxRetries, reason }) => printRetry(attempt, maxRetries, reason),
    });
  }

  // ─── Shared ──────────────────────────────────────────────────

  /**
   * Prompt user for permission on a dangerous action.
   * Returns "allow" or "deny". Handles "remember" choices by persisting rules.
   */
  private async confirmDangerous(
    toolName: string,
    input: Record<string, any>,
    displayMessage: string,
  ): Promise<"allow" | "deny"> {
    printConfirmation(displayMessage);

    // Use external confirmFn if provided (REPL mode injects one with showMenu)
    if (this.confirmFn) {
      return this.confirmFn(toolName, input);
    }

    // Fallback: interactive menu (one-shot mode, no REPL)
    const options = [
      { label: "Allow (this time only)", value: "allow" },
      { label: "Allow, and remember for this project", value: "allow-remember" },
      { label: "Deny (this time only)", value: "deny" },
      { label: "Deny, and always deny for this project", value: "deny-remember" },
    ];

    const choice = await showMenu("Allow this action? [↑/↓ + Enter]", options);

    return this.handlePermissionChoice(choice, toolName, input);
  }

  /**
   * Shared logic: interpret a menu choice and persist if "remember".
   */
  private handlePermissionChoice(
    choice: string | null,
    toolName: string,
    input: Record<string, any>,
  ): "allow" | "deny" {
    if (choice === "allow-remember") {
      const rule = generatePermissionRule(toolName, input);
      savePermissionRule(rule, "allow");
      printInfo(`Allowed & remembered: ${rule}`);
      return "allow";
    }

    if (choice === "deny-remember") {
      const rule = generatePermissionRule(toolName, input);
      savePermissionRule(rule, "deny");
      printInfo(`Denied & remembered: ${rule}`);
      return "deny";
    }

    if (choice === "allow") {
      return "allow";
    }

    // null (Ctrl+C / Escape) or "deny"
    return "deny";
  }
}
