import chalk from "chalk";
import stringWidth from "string-width";
import stripAnsi from "strip-ansi";
import { C, gradientText, gradientDivider } from "./colors.js";
import { VERSION } from "../version.js";

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

type TaskStep = {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed";
};

type Task = {
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  steps?: TaskStep[];
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Welcome — Minimalist centered box with precise border alignment
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function printWelcome(model?: string) {
  const width = 44; // inner content area width

  // Border helpers — all share exact same indent so corners align perfectly
  const borderTop = C.border("╭" + "─".repeat(width + 2) + "╮");
  const borderBottom = C.border("╰" + "─".repeat(width + 2) + "╯");
  const lineEmpty = C.border("│") + " ".repeat(width + 2) + C.border("│");
  const makeLine = (content: string) =>
    C.border("│") + " " + padVisual(content, width) + " " + C.border("│");

  // Brand name — single gradient as the only color accent in the box
  const brandText = gradientText("✻ Claude Code Mini", "#7dd3fc", "#c4b5fd");

  // Build content rows
  const rows: string[] = [
    "",                    // blank before box
    borderTop,
    lineEmpty,             // breathing room
    makeLine(brandText + "  " + C.mutedDim(`v${VERSION}`)),
    lineEmpty,             // separator space
  ];

  if (model) {
    const modelContent = C.muted("model") + "  " + C.accent(model);
    rows.push(makeLine(modelContent));
    rows.push(lineEmpty);  // separator space
  }

  const helpContent = C.muted("/help for commands") + "  " + C.mutedDim("·") + "  " + C.muted("Ctrl+C to exit");
  rows.push(makeLine(helpContent));

  rows.push(lineEmpty,   // breathing room
           borderBottom,
           "");          // blank after box

  console.log(rows.join("\n"));
}

/**
 * Display the user's input message as a styled bubble.
 * This creates clear visual separation between user and assistant output.
 */
export function printUserMessage(message: string): void {
  const termWidth = Math.min(process.stdout.columns || 50, 80);
  const innerWidth = termWidth - 6;

  // Top border — gradient
  const topBorder = gradientText("  ╭" + "─".repeat(innerWidth) + "╮", "#334155", "#7dd3fc");
  const botBorder = C.border("  ╰" + "─".repeat(innerWidth) + "╯");

  console.log("");
  console.log(topBorder);

  // User label with icon + time
  const now = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const label = C.brand("  ◆ You") + C.mutedDim("  ·") + C.muted("  " + now);
  console.log(label);

  // Message content with word wrapping
  const maxLineWidth = innerWidth - 4;
  if (visWidth(message) <= maxLineWidth) {
    console.log(C.border("  ┃ ") + C.bold(message) + C.muted(" ".repeat(Math.max(0, maxLineWidth - visWidth(message)))) + C.border(" ┃"));
  } else {
    const words = message.split(/(\s+)/);
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? currentLine + word : word;
      if (visWidth(testLine) > maxLineWidth && currentLine) {
        const padded = currentLine.padEnd(maxLineWidth);
        console.log(C.border("  ┃ ") + C.bold(padded) + C.border(" ┃"));
        currentLine = word.trimStart();
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      const padded = currentLine.padEnd(maxLineWidth);
      console.log(C.border("  ┃ ") + C.bold(padded) + C.border(" ┃"));
    }
  }

  console.log(botBorder);
}

export function printUserPrompt() {
  process.stdout.write(C.brand("\n❯ "));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tool call / result display
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TOOL_ICONS: Record<string, string> = {
  read_file:   "◈",
  list_files:  "◈",
  grep_search: "◎",
  write_file:  "◆",
  edit_file:   "◆",
  run_shell:   "▷",
  skill:       "✦",
  agent:       "▸",
  ask_user:    "⟐",
};

// Tool category colors for distinctive visual hierarchy
const TOOL_COLORS: Record<string, (s: string) => string> = {
  read_file:   chalk.hex("#7dd3fc"),   // sky — read operations
  list_files:  chalk.hex("#7dd3fc"),
  grep_search: chalk.hex("#93c5fd"),   // blue — search
  write_file:  chalk.hex("#fbbf24"),   // amber — write operations
  edit_file:   chalk.hex("#fbbf24"),
  run_shell:   chalk.hex("#a78bfa"),   // violet — execution
  skill:       chalk.hex("#c4b5fd"),   // violet-300 — skills
  agent:       chalk.hex("#818cf8"),   // indigo — agents
  ask_user:    chalk.hex("#f0abfc"),   // fuchsia — user interaction
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
  const toolColor = TOOL_COLORS[name] || C.accent;
  const summary = getToolSummary(name, input);

  // Decorative left border line
  const border = C.border("  ┊ ");

  console.log(
    border + toolColor(`${icon} `) +
    C.bold(name) +
    C.muted("  " + summary)
  );
}

const READ_ONLY_TOOLS = new Set(["read_file", "list_files", "grep_search", "web_search"]);

export function printToolResult(name: string, result: string) {
  if (READ_ONLY_TOOLS.has(name)) {
    const lines = result.split("\n").length;
    const border = C.border("  ┊ ");
    console.log(border + C.mutedDim(`↳ ${lines} lines · use read_file to view`));
    return;
  }

  const maxDisplayLines = 20;
  const contentLines = result.split("\n");
  const displayLines = contentLines.slice(0, maxDisplayLines);
  const border = C.border("  ┊ ");

  for (const line of displayLines) {
    if (!line.trim()) continue;
    const pad = border;
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
    console.log(border + C.mutedDim(`  ... (${contentLines.length - maxDisplayLines} more lines)`));
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Status messages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function printError(msg: string) {
  console.error(C.error("\n  ✗ ") + C.error(msg));
}

export function printConfirmation(command: string): void {
  console.log(
    C.warn("\n  ⚠ Allow: ") + C.bold(command)
  );
}

export function printDivider() {
  console.log(C.mutedDim("  " + "·".repeat(3)));
}

export function printRetry(attempt: number, max: number, reason: string) {
  console.log(
    C.warn(`\n  ↻ retry ${attempt}/${max}`) + C.muted(` · ${reason}`)
  );
}

export function printInfo(msg: string) {
  console.log(C.accentDim("\n  ⟐ ") + C.muted(msg));
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export function printTokenUsage(inputTokens: number, outputTokens: number) {
  const total = inputTokens + outputTokens;
  const arrow = gradientText("↳", "#4ade80", "#7dd3fc");
  console.log(
    `\n  ${arrow} ${C.muted("tokens:")} ${C.accent(fmtTokens(inputTokens) + " in")} ${C.mutedDim("·")} ${C.accent(fmtTokens(outputTokens) + " out")} ${C.mutedDim("·")} ${C.success(fmtTokens(total) + " total")}`
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Task system
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getTaskSpinnerLabel(tasks: Task[]): string | null {
  if (tasks.length === 0) return null;

  const currentTask = tasks.find((t) => t.status === "in_progress");

  if (currentTask) {
    if (currentTask.steps && currentTask.steps.length > 0) {
      const completedSteps = currentTask.steps.filter((s) => s.status === "completed").length;
      const totalSteps = currentTask.steps.length;
      const currentStep = currentTask.steps.find((s) => s.status === "in_progress");
      const text = currentStep ? currentStep.title : currentTask.activeForm || currentTask.subject;
      return `[${completedSteps}/${totalSteps}] ${text}`;
    }
    const text = currentTask.activeForm || currentTask.subject;
    const done = tasks.filter((t) => t.status === "completed").length;
    return `[${done}/${tasks.length}] ${text}`;
  }

  const done = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;

  if (done < total) {
    return `[${done}/${total}] Thinking`;
  }

  return null;
}

export function printTaskSummary(tasks: Task[]): void {
  if (tasks.length === 0) return;
  const done = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const check = gradientText("✓", "#4ade80", "#7dd3fc");
  console.log(`\n  ${check} ${C.muted("Tasks:")} ${C.success(done + "/" + total + " completed")}`);
}

export function clearTaskList(): void { }

export function renderTaskList(_tasks: Task[]): void { }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sub-agent indicators
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function printSubAgentStart(type: string, description: string) {
  const arrow = gradientText("▸", "#7dd3fc", "#818cf8");
  console.log(
    `\n  ${arrow} ${C.brand("agent")}${C.muted(` [${type}] ${description}`)}`
  );
}

export function printSubAgentEnd(type: string, _description: string) {
  const arrow = gradientText("◂", "#818cf8", "#4ade80");
  console.log(
    `  ${arrow} ${C.brand("agent")}${C.muted(` [${type}] done`)}`
  );
}
