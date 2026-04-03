import chalk from "chalk";
import stringWidth from "string-width";
import stripAnsi from "strip-ansi";

// ─── Color System ───────────────────────────────────────────
// Semantic palette — every color usage goes through here.

const C = {
  // Brand & structure
  accent:    chalk.cyan,
  accentDim: chalk.dim.cyan,
  brand:     chalk.bold.cyan,
  muted:     chalk.dim,
  border:    chalk.dim,

  // Semantic
  success:   chalk.green,
  warn:      chalk.yellow,
  error:     chalk.red.bold,
  info:      chalk.cyan,

  // Text
  bold:      chalk.bold,
  italic:    chalk.italic,
  strike:    chalk.strikethrough,

  // Code & data
  code:      chalk.cyan,
  file:      chalk.blue,
  link:      chalk.underline.blue,
  linkDim:   chalk.dim,

  // Diff
  diffAdd:   chalk.green,
  diffDel:   chalk.red,
  diffHunk:  chalk.dim.cyan,
};

// ─── Helper: visual width (handles CJK, emoji, ANSI) ───────

function visWidth(s: string): number {
  return stringWidth(stripAnsi(s));
}

function padVisual(s: string, targetWidth: number): string {
  const diff = targetWidth - visWidth(s);
  return diff > 0 ? s + " ".repeat(diff) : s;
}

// ─── Helper: format token counts ────────────────────────────


// ─── Helper: box line builder ───────────────────────────────

function boxLine(content: string, width: number): string {
  return C.border("  │") + " " + padVisual(content, width) + " " + C.border("│");
}

function boxEmpty(width: number): string {
  return C.border("  │") + " ".repeat(width + 2) + C.border("│");
}

// ─── Welcome ─────────────────────────────────────────────────

export function printWelcome(model?: string) {
  const width = 38;
  const top = C.border("  ╭" + "─".repeat(width + 2) + "╮");
  const bot = C.border("  ╰" + "─".repeat(width + 2) + "╯");
  const empty = boxEmpty(width);

  const title = C.brand("✻ Claude Code Mini") + "  " + C.muted("v1.0.0");
  const titleLine = boxLine(title, width);

  const lines = [top, empty, titleLine, empty];

  if (model) {
    const modelLine = boxLine(C.muted("model  ") + C.accent(model), width);
    lines.push(modelLine);
  }

  const helpLine = boxLine(C.muted("/help for commands"), width);
  lines.push(helpLine, empty, bot);

  console.log("\n" + lines.join("\n") + "\n");
}

// ─── User prompt ─────────────────────────────────────────────

export function printUserPrompt() {
  process.stdout.write(C.brand("\n> "));
}

// ─── Markdown Renderer ──────────────────────────────────────

class MarkdownRenderer {
  private buffer = "";
  private inCodeBlock = false;
  private codeBuffer: string[] = [];
  private codeLang = "";
  private inTable = false;
  private tableBuffer: string[] = [];

  reset(): void {
    this.buffer = "";
    this.inCodeBlock = false;
    this.codeBuffer = [];
    this.codeLang = "";
    this.inTable = false;
    this.tableBuffer = [];
  }

  flush(): void {
    if (this.inTable) {
      this.renderTable();
      this.inTable = false;
      this.tableBuffer = [];
    }
    if (this.inCodeBlock) {
      this.renderCodeBlock();
      this.inCodeBlock = false;
      this.codeBuffer = [];
      this.codeLang = "";
    }
    if (this.buffer.length > 0) {
      process.stdout.write(this.renderLine(this.buffer));
      this.buffer = "";
    }
  }

  push(chunk: string): void {
    this.buffer += chunk;
    let nlIdx: number;
    while ((nlIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nlIdx);
      this.buffer = this.buffer.slice(nlIdx + 1);
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    const trimmed = line.trimStart();

    // Code fence
    if (trimmed.startsWith("```")) {
      if (!this.inCodeBlock) {
        if (this.inTable) {
          this.renderTable();
          this.inTable = false;
          this.tableBuffer = [];
        }
        this.inCodeBlock = true;
        this.codeLang = trimmed.slice(3).trim();
        this.codeBuffer = [];
        return;
      } else {
        this.renderCodeBlock();
        this.inCodeBlock = false;
        this.codeBuffer = [];
        this.codeLang = "";
        return;
      }
    }

    if (this.inCodeBlock) {
      this.codeBuffer.push(line);
      return;
    }

    // Table detection
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (!this.inTable) {
        this.inTable = true;
        this.tableBuffer = [];
      }
      this.tableBuffer.push(line);
      return;
    }

    if (this.inTable) {
      this.renderTable();
      this.inTable = false;
      this.tableBuffer = [];
    }

    process.stdout.write(this.renderLine(line) + "\n");
  }

  private renderCodeBlock(): void {
    // Expand tabs to spaces (4-space tab stops) for consistent width calculation
    const lines = this.codeBuffer.map(l => l.replace(/\t/g, "    "));
    const langLabel = this.codeLang || "code";
    const maxLineWidth = lines.reduce((max, l) => Math.max(max, visWidth(l)), 0);
    const contentWidth = Math.max(maxLineWidth, visWidth(langLabel) + 2, 28);

    const title = `─ ${langLabel} `;
    const titlePad = "─".repeat(Math.max(contentWidth + 2 - visWidth(title), 0));
    process.stdout.write(C.border(`  ╭${title}${titlePad}╮`) + "\n");

    for (const line of lines) {
      const padded = padVisual(line, contentWidth);
      process.stdout.write(C.border("  │ ") + padded + C.border(" │") + "\n");
    }

    process.stdout.write(C.border(`  ╰${"─".repeat(contentWidth + 2)}╯`) + "\n");
  }

  private renderTable(): void {
    const rows = this.tableBuffer;
    if (rows.length === 0) return;

    const parsedRows: string[][] = [];
    for (const row of rows) {
      const cells = row.trim().split("|").slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
      parsedRows.push(cells);
    }
    if (parsedRows.length === 0) return;

    const colCount = Math.max(...parsedRows.map(r => r.length));
    const colWidths: number[] = [];
    for (let c = 0; c < colCount; c++) {
      colWidths[c] = 0;
      for (const row of parsedRows) {
        colWidths[c] = Math.max(colWidths[c], visWidth(row[c] || ""));
      }
    }

    const hr = (l: string, m: string, r: string) =>
      C.border("  " + l + colWidths.map(w => "─".repeat(w + 2)).join(m) + r);

    process.stdout.write(hr("╭", "┬", "╮") + "\n");

    // Header
    const header = parsedRows[0];
    const hCells = colWidths.map((w, i) =>
      " " + padVisual(C.bold(header[i] || ""), w) + " "
    );
    process.stdout.write(C.border("  │") + hCells.join(C.border("│")) + C.border("│") + "\n");
    process.stdout.write(hr("├", "┼", "┤") + "\n");

    // Data
    for (let r = 1; r < parsedRows.length; r++) {
      const row = parsedRows[r];
      const cells = colWidths.map((w, i) => {
        const rendered = this.renderInline(row[i] || "");
        return " " + padVisual(rendered, w) + " ";
      });
      process.stdout.write(C.border("  │") + cells.join(C.border("│")) + C.border("│") + "\n");
    }

    process.stdout.write(hr("╰", "┴", "╯") + "\n");
  }

  private renderLine(line: string): string {
    // Horizontal rule
    if (/^(\s*)([-*_])\2{2,}\s*$/.test(line)) {
      return C.muted("─".repeat(40));
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = this.renderInline(headingMatch[2]);
      if (level === 1) return "\n" + C.brand(text);
      if (level === 2) return "\n" + C.bold(text);
      return C.bold(text);
    }

    // Block quote
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      return C.accentDim("  │ ") + C.italic(this.renderInline(quoteMatch[1]));
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)([-*])\s+(.*)$/);
    if (ulMatch) {
      return ulMatch[1] + C.muted("·") + " " + this.renderInline(ulMatch[3]);
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
    if (olMatch) {
      return olMatch[1] + C.muted(olMatch[2]) + " " + this.renderInline(olMatch[3]);
    }

    return this.renderInline(line);
  }

  private renderInline(text: string): string {
    // Inline code
    text = text.replace(/`([^`]+)`/g, (_m, code) => C.code(code));
    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, (_m, t) => C.bold(t));
    // Italic
    text = text.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, (_m, t) => C.italic(t));
    text = text.replace(/(?<!\w)_([^_]+)_(?!\w)/g, (_m, t) => C.italic(t));
    // Strikethrough
    text = text.replace(/~~([^~]+)~~/g, (_m, t) => C.strike(t));
    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) =>
      C.link(label) + C.linkDim(` (${url})`)
    );
    return text;
  }
}

const mdRenderer = new MarkdownRenderer();

// ─── Assistant text ──────────────────────────────────────────

export function printAssistantText(text: string) {
  mdRenderer.push(text);
}

export function flushMarkdown(): void {
  mdRenderer.flush();
}

export function resetMarkdown(): void {
  mdRenderer.reset();
}

// ─── Tool icons by category ─────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  read_file:    "◇",   // read
  list_files:   "◇",
  grep_search:  "⊙",   // search
  write_file:   "◆",   // write
  edit_file:    "◆",
  run_shell:    "▶",   // execute
  skill:        "★",   // skill
  agent:        "▸",   // sub-agent
};

// ─── Tool call ───────────────────────────────────────────────

export function printToolCall(name: string, input: Record<string, any>) {
  const icon = TOOL_ICONS[name] || "●";
  const summary = getToolSummary(name, input);
  console.log(
    C.accentDim(`\n  ${icon} `) +
    C.accent(name) +
    C.muted("  " + summary)
  );
}

// ─── Tool result ─────────────────────────────────────────────

export function printToolResult(name: string, result: string) {
  // Edit/write results get special colorized display
  if ((name === "edit_file" || name === "write_file") && !result.startsWith("Error")) {
    printFileChangeResult(name, result);
    return;
  }

  const isError = result.startsWith("Error");
  const prefix = isError ? C.error("  ✗ ") : C.muted("  ↳ ");

  const maxLen = 500;
  const truncated =
    result.length > maxLen
      ? result.slice(0, maxLen) + C.muted(`\n    ... (${result.length} chars total)`)
      : result;

  const lines = truncated.split("\n");
  // First line with status prefix
  console.log(prefix + C.muted(lines[0]));
  // Rest indented
  for (let i = 1; i < lines.length; i++) {
    console.log(C.muted("    " + lines[i]));
  }
}

// ─── File change result ──────────────────────────────────────

function printFileChangeResult(_name: string, result: string) {
  const lines = result.split("\n");
  // Success message
  console.log(C.success("  ✓ ") + C.muted(lines[0]));

  // Diff display
  const maxDisplayLines = 40;
  const contentLines = lines.slice(1);
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

// ─── Error ───────────────────────────────────────────────────

export function printError(msg: string) {
  console.error(C.error(`\n  ✗ ${msg}`));
}

// ─── Confirmation ────────────────────────────────────────────

export function printConfirmation(command: string): void {
  console.log(
    C.warn("\n  ⚠ Allow: ") + C.bold(command)
  );
}

// ─── Interactive selection menu ──────────────────────────────

export interface MenuOption {
  label: string;
  value: string;
}

/**
 * Interactive menu with up/down key navigation.
 * Returns the selected option's value, or null if cancelled (Ctrl+C).
 *
 * IMPORTANT: When used from REPL, the caller must rl.pause() BEFORE calling
 * this function and rl.resume() AFTER it returns.
 */
export async function showMenu(title: string, options: MenuOption[]): Promise<string | null> {
  if (options.length === 0) return null;

  // Total lines we render each frame: 1 (title) + options.length
  const totalLines = 1 + options.length;

  return new Promise((resolve) => {
    let selected = 0;
    let resolved = false;
    let firstRender = true;

    // Save terminal state
    const wasRaw = process.stdin.isRaw;

    // ── Isolate stdin from readline ──────────────────────────
    // readline installs a permanent `data→keypress` pipeline on stdin via
    // emitKeypressEvents(). Even after rl.pause(), this pipeline keeps
    // emitting 'keypress' events which readline still partially handles
    // (e.g. arrow keys → history navigation, outputting old prompts).
    //
    // Fix: temporarily remove ALL 'keypress' listeners so readline is
    // completely deaf while the menu is active.
    const savedKeypressListeners = process.stdin.listeners("keypress").slice();
    process.stdin.removeAllListeners("keypress");

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      // Remove our key handler
      process.stdin.off("data", onData);
      // Restore raw mode state
      if (process.stdin.isTTY && wasRaw !== undefined) {
        process.stdin.setRawMode(wasRaw);
      }
      // Pause stdin before restoring keypress listeners, so readline
      // doesn't get stale data events when it resumes.
      process.stdin.pause();
      // Restore readline's keypress listeners
      for (const fn of savedKeypressListeners) {
        process.stdin.on("keypress", fn as (...args: any[]) => void);
      }
      // Clear the entire menu (move up totalLines, clear each)
      for (let i = 0; i < totalLines; i++) {
        process.stdout.write("\x1b[1A\x1b[2K");
      }
    };

    const render = () => {
      // On re-render: move cursor up and clear the lines we drew last time
      if (!firstRender) {
        for (let i = 0; i < totalLines; i++) {
          process.stdout.write("\x1b[1A\x1b[2K");
        }
      }
      firstRender = false;

      process.stdout.write("\x1b[?25l"); // Hide cursor
      console.log(C.muted("  " + title));
      for (let i = 0; i < options.length; i++) {
        const prefix = i === selected ? C.accent("  ❯ ") : "    ";
        const label = i === selected ? C.bold(options[i].label) : C.muted(options[i].label);
        console.log(prefix + label);
      }
      process.stdout.write("\x1b[?25h"); // Show cursor
    };

    const onData = (data: Buffer) => {
      if (resolved) return;
      const key = data.toString();

      // Up arrow
      if (key === "\x1b[A") {
        selected = (selected - 1 + options.length) % options.length;
        render();
      }
      // Down arrow
      else if (key === "\x1b[B") {
        selected = (selected + 1) % options.length;
        render();
      }
      // Enter
      else if (key === "\r" || key === "\n") {
        cleanup();
        resolve(options[selected].value);
      }
      // Ctrl+C or Escape
      else if (key === "\x03" || key === "\x1b") {
        cleanup();
        resolve(null);
      }
      // Ignore all other keys
    };

    // Enter raw mode BEFORE resuming stdin — raw mode prevents the
    // emitKeypressEvents pipeline from firing 'keypress' events.
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on("data", onData);
    // Resume stdin (it was paused by rl.pause() in REPL mode)
    process.stdin.resume();

    // Initial render
    render();
  });
}

// ─── Divider ─────────────────────────────────────────────────

export function printDivider() {
  console.log("");
}


// ─── Retry ───────────────────────────────────────────────────

export function printRetry(attempt: number, max: number, reason: string) {
  console.log(
    C.warn(`\n  ↻ retry ${attempt}/${max}`) + C.muted(` · ${reason}`)
  );
}

// ─── Info ────────────────────────────────────────────────────

export function printInfo(msg: string) {
  console.log(C.accentDim(`\n  ● `) + C.muted(msg));
}

// ─── Token usage ────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export function printTokenUsage(inputTokens: number, outputTokens: number) {
  const total = inputTokens + outputTokens;
  console.log(
    C.muted(`  ↳ tokens: ${fmtTokens(inputTokens)} in · ${fmtTokens(outputTokens)} out · ${fmtTokens(total)} total`)
  );
}

// ─── Task list display ──────────────────────────────────────
//
// Task progress is shown in two ways:
// 1. The spinner label shows the current in_progress task:
//      ⠋ [2/5] Refactoring model layers...
// 2. tool results from task_create/task_update/task_list print inline
//    (no ANSI magic, no fixed panels — just plain output).
//

import type { Task } from "../core/task-store.js";

/** Build a spinner label from the current task state. */
export function getTaskSpinnerLabel(tasks: Task[]): string | null {
  if (tasks.length === 0) return null;

  const done = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const current = tasks.find((t) => t.status === "in_progress");

  if (current) {
    const text = current.activeForm || current.subject;
    return `[${done}/${total}] ${text}`;
  }

  // No in_progress task but tasks exist
  if (done < total) {
    return `[${done}/${total}] Thinking`;
  }

  return null;  // All done
}

/**
 * Print a one-shot task summary (used when all tasks complete).
 * This is plain console.log, no ANSI rewriting.
 */
export function printTaskSummary(tasks: Task[]): void {
  if (tasks.length === 0) return;
  const done = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  console.log(C.success(`\n  ✓ Tasks: ${done}/${total} completed`));
}

/** No-op — kept for API compatibility, no panel to clear. */
export function clearTaskList(): void {
  // Nothing to clear; task state lives in spinner label
}

/** No-op — kept for API compatibility. */
export function renderTaskList(_tasks: Task[]): void {
  // Rendering is done via spinner label, not a separate panel
}

// ─── Spinner for API calls ──────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;
let currentSpinnerLabel = "Thinking";

export function startSpinner(label = "Thinking") {
  if (spinnerTimer) return;
  currentSpinnerLabel = label;
  spinnerFrame = 0;
  process.stdout.write(C.muted(`\n  ${SPINNER_FRAMES[0]} ${currentSpinnerLabel}...`));
  spinnerTimer = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    process.stdout.write(`\r\x1b[K${C.muted(`  ${SPINNER_FRAMES[spinnerFrame]} ${currentSpinnerLabel}...`)}`);
  }, 80);
}

/** Update the spinner label without restarting. No-op if spinner not running. */
export function updateSpinnerLabel(label: string) {
  if (!spinnerTimer) return;
  currentSpinnerLabel = label;
  // The next interval tick will render the new label
}

export function stopSpinner() {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    process.stdout.write("\r\x1b[K");
  }
}

// ─── Sub-agent display ──────────────────────────────────────

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

// ─── Tool summaries ─────────────────────────────────────────

function getToolSummary(name: string, input: Record<string, any>): string {
  switch (name) {
    case "read_file":
      return input.file_path;
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
    default:
      return "";
  }
}
