import chalk from "chalk";
import stringWidth from "string-width";
import stripAnsi from "strip-ansi";
import { C } from "./colors.js";

function visWidth(s: string): number {
  return stringWidth(stripAnsi(s));
}

function padVisual(s: string, targetWidth: number): string {
  const diff = targetWidth - visWidth(s);
  return diff > 0 ? s + " ".repeat(diff) : s;
}

function boxLine(content: string, width: number): string {
  return C.border("  │") + " " + padVisual(content, width) + " " + C.border("│");
}

function boxEmpty(width: number): string {
  return C.border("  │") + " ".repeat(width + 2) + C.border("│");
}

type Task = {
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
};

export function printWelcome(model?: string) {
  const width = 38;
  const top = C.border("  ╭" + "─".repeat(width + 2) + "╮");
  const bot = C.border("  ╰" + "─".repeat(width + 2) + "╯");
  const empty = boxEmpty(width);

  const title = C.brand("✻ Claude Code Mini") + "  " + C.muted("v1.0.0");
  const titleLine = boxLine(title, width);

  const lines = [top, empty, titleLine, empty];

  if (model) {
    const modelContent = C.muted("model  ") + C.accent(model);
    const modelLine = boxLine(modelContent, width);
    lines.push(modelLine);
  }

  const helpLine = boxLine(C.muted("/help for commands"), width);
  lines.push(helpLine, empty, bot);

  console.log("\n" + lines.join("\n") + "\n");
}

export function printUserPrompt() {
  process.stdout.write(C.brand("\n> "));
}

const TOOL_ICONS: Record<string, string> = {
  read_file:    "◇",
  list_files:   "◇",
  grep_search:  "⊙",
  write_file:   "◆",
  edit_file:    "◆",
  run_shell:    "▶",
  skill:        "★",
  agent:        "▸",
  ask_user:     "?",
};

function getToolSummary(name: string, input: Record<string, any>): string {
  switch (name) {
    case "read_file": {
      const offset = typeof input.offset === "number" && Number.isFinite(input.offset)
        ? Math.max(1, Math.floor(input.offset))
        : 1;
      if (input.limit === 0) {
        return `${input.file_path}  [from ${offset}, all]`;
      }
      const limit = typeof input.limit === "number" && Number.isFinite(input.limit)
        ? Math.max(1, Math.floor(input.limit))
        : 80;
      return `${input.file_path}  [offset=${offset}, limit=${limit}]`;
    }
    case "write_file":
      return input.file_path;
    case "edit_file":
      return input.file_path;
    case "list_files":
      return input.pattern;
    case "grep_search":
      return `"${input.pattern}" in ${input.path || "."}`;
    case "run_shell":
      return input.command.length > 60
        ? input.command.slice(0, 60) + "..."
        : input.command;
    case "skill":
      return input.skill_name;
    case "agent":
      return `[${input.type || "general"}] ${input.description || ""}`;
    case "ask_user": {
      const q = (input.question || "").slice(0, 60);
      return input.options ? `${q} (${input.options.length} options)` : q;
    }
    default:
      return "";
  }
}

export function printToolCall(name: string, input: Record<string, any>) {
  const icon = TOOL_ICONS[name] || "●";
  const summary = getToolSummary(name, input);
  console.log(
    C.accentDim(`\n  ${icon} `) +
    C.accent(name) +
    C.muted("  " + summary)
  );
}

const READ_ONLY_TOOLS = new Set(["read_file", "list_files", "grep_search", "web_search"]);

export function printToolResult(name: string, result: string) {
  if (READ_ONLY_TOOLS.has(name)) {
    const lines = result.split("\n").length;
    console.log(C.muted(`    [... ${lines} lines hidden, use read_file to view]`));
    return;
  }

  const maxDisplayLines = 20;
  const contentLines = result.split("\n");
  const displayLines = contentLines.slice(0, maxDisplayLines);

  for (const line of displayLines) {
    if (!line.trim()) continue;
    const pad = "    ";
    if (line.startsWith("@@")) {
      console.log(pad + C.diffHunk(line));
    } else if (line.startsWith("- ")) {
      console.log(pad + C.diffDel(line));
    } else if (line.startsWith("+ ")) {
      console.log(pad + C.diffAdd(line));
    } else {
      console.log(pad + C.muted(line));
    }
  }
  if (contentLines.length > maxDisplayLines) {
    console.log(C.muted(`    ... (${contentLines.length - maxDisplayLines} more lines)`));
  }
}

export function printError(msg: string) {
  console.error(C.error(`\n  ✗ ${msg}`));
}

export function printConfirmation(command: string): void {
  console.log(
    C.warn("\n  ⚠ Allow: ") + C.bold(command)
  );
}

export function printDivider() {
  console.log("");
}

export function printRetry(attempt: number, max: number, reason: string) {
  console.log(
    C.warn(`\n  ↻ retry ${attempt}/${max}`) + C.muted(` · ${reason}`)
  );
}

export function printInfo(msg: string) {
  console.log(C.accentDim(`\n  ● `) + C.muted(msg));
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export function printTokenUsage(inputTokens: number, outputTokens: number) {
  const total = inputTokens + outputTokens;
  console.log(
    C.success(`\n  ↳ tokens: ${fmtTokens(inputTokens)} in · ${fmtTokens(outputTokens)} out · ${fmtTokens(total)} total`)
  );
}

export function getTaskSpinnerLabel(tasks: Task[]): string | null {
  if (tasks.length === 0) return null;

  const done = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const current = tasks.find((t) => t.status === "in_progress");

  if (current) {
    const text = current.activeForm || current.subject;
    return `[${done}/${total}] ${text}`;
  }

  if (done < total) {
    return `[${done}/${total}] Thinking`;
  }

  return null;
}

export function printTaskSummary(tasks: Task[]): void {
  if (tasks.length === 0) return;
  const done = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  console.log(C.success(`\n  ✓ Tasks: ${done}/${total} completed`));
}

export function clearTaskList(): void {}

export function renderTaskList(_tasks: Task[]): void {}

export function printSubAgentStart(type: string, description: string) {
  console.log(
    C.accentDim(`\n  ▸ `) + C.accent(`agent`) + C.muted(` [${type}] ${description}`)
  );
}

export function printSubAgentEnd(type: string, _description: string) {
  console.log(
    C.accentDim(`  ◂ `) + C.accent(`agent`) + C.muted(` [${type}] done`)
  );
}
