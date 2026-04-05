import { toolDefinitions, executeTool, checkPermission, generatePermissionRule, savePermissionRule, type ToolDef, type PermissionMode, isParallelSafe, isIdempotent } from "../tools/tools.js";
import { getContextWindow, isInternalModel } from "./agent-model.js";
import { getModelForTier } from "./model-tiers.js";
import { buildSystemPrompt, loadPlanModePrompt } from "./prompt.js";
import { taskStore } from "./task-store.js";
import { saveSession } from "../storage/session.js";
import { randomUUID } from "crypto";
import { setMaxListeners } from "events";
import {
  AnthropicBackend,
  OpenAIBackend,
  type BackendConfig,
  type ToolResultEntry,
  type MessageHandler,
  type StreamResult,
} from "../backend/index.js";
import { CompressionPipeline } from "./compress.js";
import { toolStrategies } from "./agent-strategies.js";
import { resolveSubAgentModel } from "./model-tiers.js";
import { BUILTIN_AGENT_TYPES } from "../extensions/subagent.js";
import {
  printAssistantText,
  printToolCall,
  printToolResult,
  printConfirmation,
  printDivider,
  printInfo,
  printSubAgentStart,
  printSubAgentEnd,
  startSpinner,
  stopSpinner,
  updateSpinnerLabel,
  flushMarkdown,
  showMenu,
  showQuestion,
  showFreeTextInput,
  getTaskSpinnerLabel,
  printTaskSummary,
  printTokenUsage,
} from "../ui/index.js";

interface AgentOptions {
  permissionMode?: PermissionMode;
  yolo?: boolean;
  model?: string;
  apiBase?: string;
  anthropicBaseURL?: string;
  apiKey?: string;
  thinking?: boolean;
  maxTurns?: number;
  confirmFn?: (toolName: string, input: Record<string, any>) => Promise<"allow" | "deny">;
  askUserFn?: (question: string, options?: string[], allowFreeText?: boolean) => Promise<string>;
  customSystemPrompt?: string;
  customTools?: ToolDef[];
  isSubAgent?: boolean;
}

export class Agent {
  private backend: MessageHandler;
  private compression: CompressionPipeline;
  private permissionMode: PermissionMode;
  private thinking: boolean;
  private _model: string;
  private systemPrompt: string;
  private tools: ToolDef[];
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private effectiveWindow: number;
  private sessionId: string;
  private sessionStartTime: string;
  private isSubAgent: boolean;

  private maxTurns?: number;
  private currentTurns = 0;
  private unsubscribeTaskStore?: () => void;
  private abortController: AbortController | null = null;
  private confirmedPaths: Set<string> = new Set();
  private confirmFn?: (toolName: string, input: Record<string, any>) => Promise<"allow" | "deny">;
  private askUserFn?: (question: string, options?: string[], allowFreeText?: boolean) => Promise<string>;
  private outputBuffer: string[] | null = null;
  private apiBase?: string;
  private apiKey?: string;
  private anthropicBaseURL?: string;

  get model(): string { return this._model; }

  constructor(options: AgentOptions = {}) {
    this.permissionMode = options.permissionMode || (options.yolo ? "bypassPermissions" : "default");
    this.thinking = options.thinking || false;
    this._model = options.model || getModelForTier("pro");
    this.isSubAgent = options.isSubAgent || false;
    this.tools = options.customTools || toolDefinitions;
    this.maxTurns = options.maxTurns;
    this.confirmFn = options.confirmFn;
    this.askUserFn = options.askUserFn;
    this.effectiveWindow = getContextWindow(this._model) - 20000;
    this.sessionId = randomUUID().slice(0, 8);
    this.sessionStartTime = new Date().toISOString();
    this.apiBase = options.apiBase;
    this.apiKey = options.apiKey;
    this.anthropicBaseURL = options.anthropicBaseURL;

    let sysPrompt = options.customSystemPrompt || buildSystemPrompt();
    if (this.permissionMode === "plan") {
      sysPrompt += "\n\n" + loadPlanModePrompt();
    }
    this.systemPrompt = sysPrompt;

    const backendConfig: BackendConfig = {
      model: this._model,
      systemPrompt: this.systemPrompt,
      tools: this.tools,
      thinking: this.thinking,
      apiKey: options.apiKey,
      baseURL: options.apiBase,
    };

    const emitText = (text: string) => this.emitText(text);

    // Backend instantiation — the only place that knows the concrete type
    const useOpenAI = !!options.apiBase;
    if (useOpenAI) {
      this.backend = new OpenAIBackend(backendConfig, this.isSubAgent, emitText);
    } else {
      const config = { ...backendConfig, baseURL: options.anthropicBaseURL };
      this.backend = new AnthropicBackend(config, this.isSubAgent, emitText);
    }

    this.compression = new CompressionPipeline(
      this.effectiveWindow,
      (id) => this.backend.findToolUseById(id),
    );

    if (!this.isSubAgent) {
      this.unsubscribeTaskStore = taskStore.onChange(() => {
        const label = getTaskSpinnerLabel(taskStore.list());
        if (label) updateSpinnerLabel(label);
      });
    }
  }

  private showSpinner(label?: string): void {
    if (this.isSubAgent) return;
    const taskLabel = getTaskSpinnerLabel(taskStore.list());
    startSpinner(taskLabel || label || "Thinking");
  }

  private hideSpinner(): void {
    if (this.isSubAgent) return;
    stopSpinner();
  }

  abort() {
    this.abortController?.abort();
  }

  switchModel(newModel: string): { model: string; known: boolean } {
    if (newModel === this._model) return { model: this._model, known: true };
    const known = isInternalModel(newModel);
    this._model = newModel;
    this.effectiveWindow = getContextWindow(newModel) - 20000;
    this.backend.updateModel(newModel);
    return { model: this._model, known };
  }

  get isProcessing(): boolean {
    return this.abortController !== null;
  }

  setConfirmFn(fn: (toolName: string, input: Record<string, any>) => Promise<"allow" | "deny">) {
    this.confirmFn = fn;
  }

  setAskUserFn(fn: (question: string, options?: string[], allowFreeText?: boolean) => Promise<string>) {
    this.askUserFn = fn;
  }

  getTokenUsage() {
    return { input: this.totalInputTokens, output: this.totalOutputTokens };
  }

  // ─── Chat entry point ───────────────────────────────────────

  async chat(userMessage: string): Promise<void> {
    this.abortController = new AbortController();
    setMaxListeners(100, this.abortController.signal);

    this.backend.addUserMessage(userMessage);

    try {
      await this.chatLoop();
    } finally {
      this.abortController = null;
    }

    if (!this.isSubAgent) {
      const tasks = taskStore.list();
      if (tasks.length > 0 && tasks.every((t) => t.status === "completed")) {
        printTaskSummary(tasks);
      }
      printTokenUsage(this.totalInputTokens, this.totalOutputTokens);
      printDivider();
      this.autoSave();
    }
  }

  // ─── Core chat loop ─────────────────────────────────────────

  private async chatLoop(): Promise<void> {
    while (true) {
      if (this.abortController?.signal.aborted) break;
      const toolResults: ToolResultEntry[] = [];
      this.backend.runCompression(this.compression, this.totalInputTokens);
      this.compression.updateApiCallTime();

      if (!this.isSubAgent) this.showSpinner();
      let firstText = true;
      let content = "";
      let toolCalls: StreamResult["toolCalls"] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let rawAssistantContent: unknown[] | undefined;

      // stream parallel tool calls(only for parallel safe tools)
      const parallelPromises = new Map<string, Promise<ToolResultEntry | null>>();

      try {
        for await (const chunk of this.backend.streamChunk(this.abortController?.signal)) {
          if (chunk.content) {
            if (firstText) {
              if (!this.isSubAgent) {
                this.hideSpinner();
              }
              this.emitText("\n");
              firstText = false;
            }
            content += chunk.content;
            // emit the content to the UI
            this.emitText(chunk.content);
          }
          if (chunk.toolCall) {
            // collect all tool calls
            toolCalls.push(chunk.toolCall);
            if (isParallelSafe(chunk.toolCall.name) && isIdempotent(chunk.toolCall.name)) {
              // execute the tool call parallel
              parallelPromises.set(
                chunk.toolCall.id,
                this.executeToolImpl(chunk.toolCall.name, chunk.toolCall.id, chunk.toolCall.arguments, false)
              );
            }
          }
          if (chunk.usage) {
            // update the token usage
            inputTokens = chunk.usage.inputTokens;
            outputTokens = chunk.usage.outputTokens;
          }
          if (chunk.rawAssistantContent) {
            rawAssistantContent = chunk.rawAssistantContent;
          }
        }
      } catch (e: any) {
        if (!this.isSubAgent) this.hideSpinner();
        console.error("[API Error]", e.message, e.response?.data);
        throw e;
      }
      if (!this.isSubAgent) this.hideSpinner();

      this.totalInputTokens += inputTokens;
      this.totalOutputTokens += outputTokens;

      // auto compact conversation
      if (inputTokens > this.effectiveWindow * 0.85) {
        printInfo("Context window filling up, compacting conversation...");
        const compactModel = resolveSubAgentModel(BUILTIN_AGENT_TYPES.COMPACT).model;
        await this.backend.compactConversation(compactModel);
        printInfo("Conversation compacted.");
      }

      if (toolCalls.length === 0) {
        if (!this.isSubAgent) flushMarkdown();
        break;
      }

      this.currentTurns++;
      const budget = this.checkBudget();
      if (budget.exceeded) {
        printInfo(`Budget exceeded: ${budget.reason}`);
        break;
      }

      // wait for parallel tool calls to finish
      const parallelResults = await Promise.all(parallelPromises.values());
      for (const r of parallelResults) {
        if (r) toolResults.push(r);
      }

      // execute the remaining tool calls
      for (const tc of toolCalls) {
        if (this.abortController?.signal.aborted) break;
        if (parallelPromises.has(tc.id)) continue;
        const toolResult = await this.executeToolWithPermissions(tc.name, tc.id, tc.arguments, false);
        if (toolResult) toolResults.push(toolResult);
      }

      if (!this.isSubAgent) this.printToolResultsInOrder(toolCalls, toolResults);

      this.backend.addToolRound({ content, toolCalls, usage: { inputTokens, outputTokens }, rawAssistantContent }, toolResults);
    }
  }

  // ─── Tool execution with permissions ────────────────────────

  private async executeToolWithPermissions(name: string, toolCallId: string, args: string, printResults = true): Promise<ToolResultEntry | null> {
    return this.executeToolImpl(name, toolCallId, args, printResults);
  }

  private async executeToolWithPermissionParallel(name: string, toolCallId: string, args: string, printResults = true): Promise<ToolResultEntry | null> {
    return this.executeToolImpl(name, toolCallId, args, printResults);
  }

  private async executeToolImpl(name: string, toolCallId: string, args: string, printResults = true): Promise<ToolResultEntry | null> {
    let input: Record<string, any>;
    try {
      input = JSON.parse(args);
    } catch {
      input = {};
    }

    if (printResults) printToolCall(name, input);

    const perm = checkPermission(name, input, this.permissionMode);
    if (perm.action === "deny") {
      if (printResults) printInfo(`Denied: ${perm.message}`);
      return { toolCallId, content: `Action denied: ${perm.message}` };
    }
    if (perm.action === "confirm" && perm.message && !this.confirmedPaths.has(perm.message)) {
      const choice = await this.confirmDangerous(name, input, perm.message);
      if (choice === "deny") {
        return { toolCallId, content: "User denied this action." };
      }
      this.confirmedPaths.add(perm.message);
    }

    const result = await this.executeToolCall(name, input);
    if (printResults) printToolResult(name, result);
    return { toolCallId, content: result };
  }

  private printToolResultsInOrder(toolCalls: StreamResult["toolCalls"], toolResults: ToolResultEntry[]) {
    const resultMap = new Map(toolResults.map(r => [r.toolCallId, r]));
    for (const tc of toolCalls) {
      const result = resultMap.get(tc.id);
      if (!result) continue;
      printToolCall(tc.name, JSON.parse(tc.arguments || "{}"));
      printToolResult(tc.name, result.content);
    }
  }

  // ─── Permission confirmation (with remember) ───────────────

  private async confirmDangerous(toolName: string, input: Record<string, any>, displayMessage: string): Promise<"allow" | "deny"> {
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

    const choice = await showMenu("Allow this action? [up/down + Enter]", options);

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
    return choice === "allow" ? "allow" : "deny";
  }

  // ─── Sub-agent output capture ──────────────────────────────

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

  private emitText(text: string): void {
    if (this.outputBuffer) {
      this.outputBuffer.push(text);
    } else {
      printAssistantText(text);
    }
  }

  // ─── REPL commands ──────────────────────────────────────────

  clearHistory() {
    this.backend.clearMessages();
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    taskStore.clear();
    printInfo("Conversation cleared.");
  }

  private checkBudget(): { exceeded: boolean; reason?: string } {
    if (this.maxTurns !== undefined && this.currentTurns >= this.maxTurns) {
      return { exceeded: true, reason: `Turn limit reached (${this.currentTurns} >= ${this.maxTurns})` };
    }
    return { exceeded: false };
  }

  async compact() {
    // Run tier 1-3 zero-cost compression
    this.backend.runCompression(this.compression, this.totalInputTokens);
    // Tier 4: API-based summarization
    const compactModel = resolveSubAgentModel(BUILTIN_AGENT_TYPES.COMPACT).model;
    await this.backend.compactConversation(compactModel);
    printInfo("Conversation compacted.");
  }

  // ─── Session persistence ────────────────────────────────────

  restoreSession(data: { anthropicMessages?: unknown[]; openaiMessages?: unknown[] }) {
    const type = this.backend.getBackendType();
    if (type === "openai" && data.openaiMessages) {
      this.backend.setMessages(data.openaiMessages);
    } else if (type === "anthropic" && data.anthropicMessages) {
      this.backend.setMessages(data.anthropicMessages);
    }
    printInfo(`Session restored (${this.getMessageCount()} messages).`);
  }

  private getMessageCount(): number {
    return this.backend.getMessages().length;
  }

  private autoSave() {
    try {
      const type = this.backend.getBackendType();
      const msgs = this.backend.getMessages();
      saveSession(this.sessionId, {
        metadata: {
          id: this.sessionId,
          model: this.model,
          cwd: process.cwd(),
          startTime: this.sessionStartTime,
          messageCount: this.getMessageCount(),
        },
        anthropicMessages: type === "anthropic" ? msgs : undefined,
        openaiMessages: type === "openai" ? msgs : undefined,
      });
    } catch { }
  }

  // ─── Tool dispatch ──────────────────────────────────────────

  private async executeToolCall(name: string, input: Record<string, any>): Promise<string> {
    // Use strategy pattern for agent and skill tools
    if (toolStrategies.has(name)) {
      const strategy = toolStrategies.get(name)!;
      return strategy.execute(this, input);
    }
    if (name === "ask_user") return this.executeAskUserTool(input);
    return executeTool(name, input);
  }

  private async executeAskUserTool(input: Record<string, any>): Promise<string> {
    const question = input.question || "No question provided";
    const options = Array.isArray(input.options) ? input.options as string[] : undefined;
    const allowFreeText = !!input.allow_free_text;

    if (this.isSubAgent) {
      return "Error: ask_user is not available in sub-agent context.";
    }

    this.hideSpinner();

    try {
      if (this.askUserFn) {
        const answer = await this.askUserFn(question, options, allowFreeText);
        return `User's answer: ${answer}`;
      }
      if (options && options.length > 0) {
        const answer = await showQuestion(question, options, allowFreeText);
        return `User's answer: ${answer}`;
      } else {
        const answer = await showFreeTextInput(question);
        return `User's answer: ${answer}`;
      }
    } catch (e: any) {
      return `Error asking user: ${e.message}`;
    }
  }
}
