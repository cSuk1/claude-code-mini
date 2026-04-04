export const SNIPPABLE_TOOLS = new Set(["read_file", "grep_search", "list_files", "run_shell"]);
export const SNIP_PLACEHOLDER = "[Content snipped - re-read if needed]";
export const SNIP_THRESHOLD = 0.60;
export const MICROCOMPACT_IDLE_MS = 5 * 60 * 1000;
export const KEEP_RECENT_RESULTS = 3;
export const OLD_RESULT_PLACEHOLDER = "[Old result cleared]";

export class CompressionPipeline {
  private lastApiCallTime = 0;

  constructor(
    private effectiveWindow: number,
    private findToolUseById?: (id: string) => { name: string; input: any } | null
  ) {}

  updateApiCallTime(): void {
    this.lastApiCallTime = Date.now();
  }

  runAnthropic(messages: any[], tokenCount: number): void {
    this.budgetToolResultsAnthropic(messages, tokenCount);
    this.snipStaleResultsAnthropic(messages, tokenCount);
    this.microcompactAnthropic(messages);
  }

  runOpenAI(messages: any[], tokenCount: number): void {
    this.budgetToolResultsOpenAI(messages, tokenCount);
    this.snipStaleResultsOpenAI(messages, tokenCount);
    this.microcompactOpenAI(messages);
  }

  private budgetToolResultsAnthropic(messages: any[], tokenCount: number): void {
    const utilization = tokenCount / this.effectiveWindow;
    if (utilization < 0.5) return;
    const budget = utilization > 0.7 ? 15000 : 30000;

    for (const msg of messages) {
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

  private budgetToolResultsOpenAI(messages: any[], tokenCount: number): void {
    const utilization = tokenCount / this.effectiveWindow;
    if (utilization < 0.5) return;
    const budget = utilization > 0.7 ? 15000 : 30000;

    for (const msg of messages) {
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

  private snipStaleResultsAnthropic(messages: any[], tokenCount: number): void {
    const utilization = tokenCount / this.effectiveWindow;
    if (utilization < SNIP_THRESHOLD) return;

    const results: { msgIdx: number; blockIdx: number; toolName: string; filePath?: string }[] = [];
    for (let mi = 0; mi < messages.length; mi++) {
      const msg = messages[mi];
      if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
      for (let bi = 0; bi < msg.content.length; bi++) {
        const block = msg.content[bi] as any;
        if (block.type === "tool_result" && typeof block.content === "string" && block.content !== SNIP_PLACEHOLDER) {
          const toolUseId = block.tool_use_id;
          const toolInfo = this.findToolUseById?.(toolUseId);
          if (toolInfo && SNIPPABLE_TOOLS.has(toolInfo.name)) {
            results.push({ msgIdx: mi, blockIdx: bi, toolName: toolInfo.name, filePath: toolInfo.input?.file_path });
          }
        }
      }
    }

    if (results.length <= KEEP_RECENT_RESULTS) return;

    const toSnip = new Set<number>();
    const seenFiles = new Map<string, number[]>();

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.toolName === "read_file" && r.filePath) {
        const existing = seenFiles.get(r.filePath) || [];
        existing.push(i);
        seenFiles.set(r.filePath, existing);
      }
    }

    for (const indices of seenFiles.values()) {
      if (indices.length > 1) {
        for (let j = 0; j < indices.length - 1; j++) toSnip.add(indices[j]);
      }
    }

    const snipBefore = results.length - KEEP_RECENT_RESULTS;
    for (let i = 0; i < snipBefore; i++) toSnip.add(i);

    for (const idx of toSnip) {
      const r = results[idx];
      const block = (messages[r.msgIdx].content as any[])[r.blockIdx];
      block.content = SNIP_PLACEHOLDER;
    }
  }

  private snipStaleResultsOpenAI(messages: any[], tokenCount: number): void {
    const utilization = tokenCount / this.effectiveWindow;
    if (utilization < SNIP_THRESHOLD) return;

    const toolMsgs: { idx: number }[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as any;
      if (msg.role === "tool" && typeof msg.content === "string" && msg.content !== SNIP_PLACEHOLDER) {
        toolMsgs.push({ idx: i });
      }
    }

    if (toolMsgs.length <= KEEP_RECENT_RESULTS) return;

    const snipCount = toolMsgs.length - KEEP_RECENT_RESULTS;
    for (let i = 0; i < snipCount; i++) {
      (messages[toolMsgs[i].idx] as any).content = SNIP_PLACEHOLDER;
    }
  }

  private microcompactAnthropic(messages: any[]): void {
    if (!this.lastApiCallTime || (Date.now() - this.lastApiCallTime) < MICROCOMPACT_IDLE_MS) return;

    const allResults: { msgIdx: number; blockIdx: number }[] = [];
    for (let mi = 0; mi < messages.length; mi++) {
      const msg = messages[mi];
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
      (messages[r.msgIdx].content as any[])[r.blockIdx].content = OLD_RESULT_PLACEHOLDER;
    }
  }

  private microcompactOpenAI(messages: any[]): void {
    if (!this.lastApiCallTime || (Date.now() - this.lastApiCallTime) < MICROCOMPACT_IDLE_MS) return;

    const toolMsgs: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as any;
      if (msg.role === "tool" && typeof msg.content === "string" &&
          msg.content !== SNIP_PLACEHOLDER && msg.content !== OLD_RESULT_PLACEHOLDER) {
        toolMsgs.push(i);
      }
    }

    const clearCount = toolMsgs.length - KEEP_RECENT_RESULTS;
    for (let i = 0; i < clearCount && i < toolMsgs.length; i++) {
      (messages[toolMsgs[i]] as any).content = OLD_RESULT_PLACEHOLDER;
    }
  }
}
