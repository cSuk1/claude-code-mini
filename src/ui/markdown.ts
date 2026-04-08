import stringWidth from "string-width";
import stripAnsi from "strip-ansi";
import chalk from "chalk";
import { C, gradientText, gradientDivider } from "./colors.js";
import { highlightCode } from "./syntax-highlight.js";

function visWidth(s: string): number {
  return stringWidth(stripAnsi(s));
}

function padVisual(s: string, targetWidth: number): string {
  const diff = targetWidth - visWidth(s);
  return diff > 0 ? s + " ".repeat(diff) : s;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MarkdownRenderer — Elegant stream renderer with gradient borders
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

  // ── Code block with gradient border, language badge & syntax highlighting ──
  private renderCodeBlock(): void {
    const lines = this.codeBuffer.map(l => l.replace(/\t/g, "    "));
    const langLabel = this.codeLang || "code";

    // Apply syntax highlighting based on language
    const highlightedLines = highlightCode(lines, langLabel);

    const maxLineWidth = lines.reduce((max, l) => Math.max(max, visWidth(l)), 0);
    const contentWidth = Math.max(maxLineWidth, visWidth(langLabel) + 2, 28);

    // Top border with language badge — gradient from slate to indigo
    const badge = ` ◈ ${langLabel} `;
    const badgePad = "━".repeat(Math.max(contentWidth + 2 - visWidth(badge), 0));
    const topBorder = gradientText("╭" + badge + badgePad + "╮", "#334155", "#818cf8");
    process.stdout.write(topBorder + "\n");

    // Code lines with syntax highlighting and subtle left accent
    for (let i = 0; i < highlightedLines.length; i++) {
      const padded = padVisual(highlightedLines[i], contentWidth);
      process.stdout.write(C.border("┃ ") + padded + C.border(" ┃") + "\n");
    }

    // Bottom border — gradient from indigo back to slate
    const botBorder = gradientText("╰" + "━".repeat(contentWidth + 2) + "╯", "#818cf8", "#334155");
    process.stdout.write(botBorder + "\n");
  }

  // ── Table with gradient header separators ──
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

    const hr = (l: string, m: string, r: string, gradient = false) => {
      const line = l + colWidths.map(w => "━".repeat(w + 2)).join(m) + r;
      return gradient ? gradientText(line, "#334155", "#818cf8") : C.border(line);
    };

    // Top border with gradient
    process.stdout.write(hr("╭", "┬", "╮", true) + "\n");

    // Header row with bold accent
    const header = parsedRows[0];
    const hCells = colWidths.map((w, i) =>
      " " + padVisual(C.brand(header[i] || ""), w) + " "
    );
    process.stdout.write(C.border("┃") + hCells.join(C.border("┃")) + C.border("┃") + "\n");

    // Header-body separator with gradient
    process.stdout.write(hr("┣", "╋", "┫", true) + "\n");

    // Body rows
    for (let r = 1; r < parsedRows.length; r++) {
      const row = parsedRows[r];
      const cells = colWidths.map((w, i) => {
        const rendered = this.renderInline(row[i] || "");
        return " " + padVisual(rendered, w) + " ";
      });
      process.stdout.write(C.border("┃") + cells.join(C.border("┃")) + C.border("┃") + "\n");
    }

    // Bottom border with gradient
    process.stdout.write(hr("╰", "┻", "╯", true) + "\n");
  }

  // ── Line-level rendering with refined styling ──
  private renderLine(line: string): string {
    // Horizontal rule — gradient divider
    if (/^(\s*)([-*_])\2{2,}\s*$/.test(line)) {
      return gradientDivider(40);
    }

    // Headings — gradient from accent to brand
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = this.renderInline(headingMatch[2]);
      if (level === 1) {
        return "\n" + gradientText("◆ " + headingMatch[2], "#7dd3fc", "#c4b5fd") + "\n" +
               gradientText("━".repeat(Math.min(visWidth(headingMatch[2]) + 3, 50)), "#334155", "#818cf8");
      }
      if (level === 2) {
        return "\n" + C.brand("◇ " + headingMatch[2]);
      }
      return C.brandDim(text);
    }

    // Blockquote — styled with accent border
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      return C.accentDim("  ┃ ") + C.italic(this.renderInline(quoteMatch[1]));
    }

    // Unordered list — decorative dots
    const ulMatch = line.match(/^(\s*)([-*])\s+(.*)$/);
    if (ulMatch) {
      return ulMatch[1] + C.gradient2("◈") + " " + this.renderInline(ulMatch[3]);
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
    if (olMatch) {
      return olMatch[1] + C.brandDim(olMatch[2]) + " " + this.renderInline(olMatch[3]);
    }

    return this.renderInline(line);
  }

  // ── Inline rendering with richer color hierarchy ──
  private renderInline(text: string): string {
    // Inline code — violet tinted
    text = text.replace(/`([^`]+)`/g, (_m, code) => C.code(code));
    // Bold — bright accent
    text = text.replace(/\*\*([^*]+)\*\*/g, (_m, t) => C.bold(t));
    // Italic — soft brand
    text = text.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, (_m, t) => C.italic(t));
    text = text.replace(/(?<!\w)_([^_]+)_(?!\w)/g, (_m, t) => C.italic(t));
    // Strikethrough
    text = text.replace(/~~([^~]+)~~/g, (_m, t) => C.strike(t));
    // Links — sky accent
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) =>
      C.link(label) + C.linkDim(` (${url})`)
    );
    return text;
  }
}

const mdRenderer = new MarkdownRenderer();

export function printAssistantText(text: string) {
  mdRenderer.push(text);
}

export function flushMarkdown(): void {
  mdRenderer.flush();
}

export function resetMarkdown(): void {
  mdRenderer.reset();
}
