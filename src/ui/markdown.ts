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

  private renderCodeBlock(): void {
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

    const header = parsedRows[0];
    const hCells = colWidths.map((w, i) =>
      " " + padVisual(C.bold(header[i] || ""), w) + " "
    );
    process.stdout.write(C.border("  │") + hCells.join(C.border("│")) + C.border("│") + "\n");
    process.stdout.write(hr("├", "┼", "┤") + "\n");

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
    if (/^(\s*)([-*_])\2{2,}\s*$/.test(line)) {
      return C.muted("─".repeat(40));
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = this.renderInline(headingMatch[2]);
      if (level === 1) return "\n" + C.brand(text);
      if (level === 2) return "\n" + C.bold(text);
      return C.bold(text);
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      return C.accentDim("  │ ") + C.italic(this.renderInline(quoteMatch[1]));
    }

    const ulMatch = line.match(/^(\s*)([-*])\s+(.*)$/);
    if (ulMatch) {
      return ulMatch[1] + C.muted("·") + " " + this.renderInline(ulMatch[3]);
    }

    const olMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
    if (olMatch) {
      return olMatch[1] + C.muted(olMatch[2]) + " " + this.renderInline(olMatch[3]);
    }

    return this.renderInline(line);
  }

  private renderInline(text: string): string {
    text = text.replace(/`([^`]+)`/g, (_m, code) => C.code(code));
    text = text.replace(/\*\*([^*]+)\*\*/g, (_m, t) => C.bold(t));
    text = text.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, (_m, t) => C.italic(t));
    text = text.replace(/(?<!\w)_([^_]+)_(?!\w)/g, (_m, t) => C.italic(t));
    text = text.replace(/~~([^~]+)~~/g, (_m, t) => C.strike(t));
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
