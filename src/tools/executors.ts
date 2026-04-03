import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { execSync, execFileSync } from "child_process";
import { glob } from "glob";
import { dirname, join } from "path";
import { getMemoryDir } from "../storage/memory.js";
import { taskStore } from "../core/task-store.js";

const isWin = process.platform === "win32";
const DEFAULT_READ_FILE_LINES = 80;
const MAX_READ_FILE_LINES = 200;
const FILE_PREVIEW_LINES = 30;
const MAX_FILE_LIST_RESULTS = 200;
const MAX_GREP_RESULTS = 100;
const MAX_GREP_SCAN_RESULTS = 200;

type ToolInput = Record<string, any>;

type ToolHandler = (input: ToolInput) => string | Promise<string>;

function formatWithLineNumbers(content: string, startLine = 1, maxLines?: number): string {
  const lines = content.split("\n");
  const shown = typeof maxLines === "number" ? lines.slice(0, maxLines) : lines;
  return shown
    .map((line, i) => `${String(startLine + i).padStart(4)} | ${line}`)
    .join("\n");
}

function clampPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function parseReadFileLimit(value: unknown): { unlimited: boolean; requestedLimit: number } {
  if (value === 0) {
    return { unlimited: true, requestedLimit: 0 };
  }

  const requestedLimit = clampPositiveInteger(value, DEFAULT_READ_FILE_LINES);
  return { unlimited: false, requestedLimit };
}

function readFile(input: { file_path: string; offset?: number; limit?: number }): string {
  try {
    const content = readFileSync(input.file_path, "utf-8");
    const lines = content.split("\n");

    if (lines.length === 1 && lines[0] === "") {
      return `File is empty: ${input.file_path}`;
    }

    const startLine = clampPositiveInteger(input.offset, 1);
    const { unlimited, requestedLimit } = parseReadFileLimit(input.limit);
    const limit = unlimited ? lines.length - startLine + 1 : Math.min(requestedLimit, MAX_READ_FILE_LINES);

    if (startLine > lines.length) {
      return `Error reading file: line ${startLine} is out of range (file has ${lines.length} lines)`;
    }

    const startIndex = startLine - 1;
    const selected = lines.slice(startIndex, startIndex + limit);
    const preview = formatWithLineNumbers(selected.join("\n"), startLine);
    const endLine = startLine + selected.length - 1;
    const moreAbove = startLine > 1;
    const moreBelow = endLine < lines.length;
    const limitNote = unlimited
      ? " (all remaining content requested)"
      : requestedLimit > MAX_READ_FILE_LINES
        ? ` (requested ${requestedLimit}, capped at ${MAX_READ_FILE_LINES})`
        : "";

    const header = `Showing lines ${startLine}-${endLine} of ${lines.length} from ${input.file_path}${limitNote}`;
    const footer = !unlimited && (moreAbove || moreBelow)
      ? `\n\nUse read_file with offset and limit to read more.${moreAbove ? ` Earlier lines available before ${startLine}.` : ""}${moreBelow ? ` More lines available after ${endLine}.` : ""}`
      : "";

    return `${header}\n\n${preview}${footer}`;
  } catch (e: any) {
    return `Error reading file: ${e.message}`;
  }
}

function writeFile(input: { file_path: string; content: string }): string {
  try {
    const dir = dirname(input.file_path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(input.file_path, input.content);
    autoUpdateMemoryIndex(input.file_path);

    const lineCount = input.content.split("\n").length;
    const preview = formatWithLineNumbers(input.content, FILE_PREVIEW_LINES);
    const truncNote = lineCount > FILE_PREVIEW_LINES ? `\n  ... (${lineCount} lines total)` : "";
    return `Successfully wrote to ${input.file_path} (${lineCount} lines)\n\n${preview}${truncNote}`;
  } catch (e: any) {
    return `Error writing file: ${e.message}`;
  }
}

function extractMemoryMetadata(content: string): { name: string; type: string; description: string } | null {
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const typeMatch = content.match(/^type:\s*(.+)$/m);
  if (!nameMatch || !typeMatch) return null;

  const descMatch = content.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch[1].trim(),
    type: typeMatch[1].trim(),
    description: descMatch?.[1]?.trim() || "",
  };
}

function autoUpdateMemoryIndex(filePath: string): void {
  try {
    const memDir = getMemoryDir();
    if (filePath.startsWith(memDir) && filePath.endsWith(".md") && !filePath.endsWith("MEMORY.md")) {
      const files = readdirSync(memDir).filter(
        (f: string) => f.endsWith(".md") && f !== "MEMORY.md"
      );
      const lines = ["# Memory Index", ""];
      for (const file of files) {
        try {
          const raw = readFileSync(join(memDir, file), "utf-8");
          const metadata = extractMemoryMetadata(raw);
          if (!metadata) continue;
          lines.push(`- **[${metadata.name}](${file})** (${metadata.type}) — ${metadata.description}`);
        } catch {
          // skip invalid memory entries
        }
      }
      writeFileSync(join(memDir, "MEMORY.md"), lines.join("\n"));
    }
  } catch {
    // non-critical
  }
}

function normalizeQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"');
}

function findActualString(fileContent: string, searchString: string): string | null {
  if (fileContent.includes(searchString)) return searchString;
  const normSearch = normalizeQuotes(searchString);
  const normFile = normalizeQuotes(fileContent);
  const idx = normFile.indexOf(normSearch);
  if (idx !== -1) return fileContent.substring(idx, idx + searchString.length);
  return null;
}

function generateDiff(oldContent: string, oldString: string, newString: string): string {
  const beforeChange = oldContent.split(oldString)[0];
  const lineNum = (beforeChange.match(/\n/g) || []).length + 1;
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");

  const parts: string[] = [`@@ -${lineNum},${oldLines.length} +${lineNum},${newLines.length} @@`];
  for (const l of oldLines) parts.push(`- ${l}`);
  for (const l of newLines) parts.push(`+ ${l}`);

  return parts.join("\n");
}

function editFile(input: {
  file_path: string;
  old_string: string;
  new_string: string;
}): string {
  try {
    const content = readFileSync(input.file_path, "utf-8");
    const actual = findActualString(content, input.old_string);
    if (!actual) {
      return `Error: old_string not found in ${input.file_path}`;
    }

    const count = content.split(actual).length - 1;
    if (count > 1) {
      return `Error: old_string found ${count} times in ${input.file_path}. Must be unique.`;
    }

    const newContent = content.split(actual).join(input.new_string);
    writeFileSync(input.file_path, newContent);

    const diff = generateDiff(content, actual, input.new_string);
    const quoteNote = actual !== input.old_string ? " (matched via quote normalization)" : "";
    return `Successfully edited ${input.file_path}${quoteNote}\n\n${diff}`;
  } catch (e: any) {
    return `Error editing file: ${e.message}`;
  }
}

async function listFiles(input: {
  pattern: string;
  path?: string;
}): Promise<string> {
  // Try ripgrep first (faster with built-in sorting), fallback to Node glob
  const hasRg = checkCommandAvailable("rg");
  
  if (hasRg) {
    return listFilesWithRipgrep(input);
  }
  
  return listFilesWithGlob(input);
}

async function listFilesWithRipgrep(input: {
  pattern: string;
  path?: string;
}): Promise<string> {
  try {
    const args = [
      "--files",
      "--glob", input.pattern,
      "--sort=modified",      // Sort by modification time (newest first)
      "--no-ignore-vcs",      // Respect .gitignore by default
      "--no-ignore-global",   // Don't use global gitignore
      "--hidden",             // Include hidden files
    ];
    
    const result = execFileSync("rg", args, {
      cwd: input.path || process.cwd(),
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      timeout: 10000,
    });
    
    const files = result.split("\n").filter(Boolean);
    if (files.length === 0) return "No files found matching the pattern.";
    return files.slice(0, MAX_FILE_LIST_RESULTS).join("\n") +
      (files.length > MAX_FILE_LIST_RESULTS ? `\n... and ${files.length - MAX_FILE_LIST_RESULTS} more` : "");
  } catch (e: any) {
    // Fallback to glob if ripgrep fails
    return listFilesWithGlob(input);
  }
}

async function listFilesWithGlob(input: {
  pattern: string;
  path?: string;
}): Promise<string> {
  try {
    const files = await glob(input.pattern, {
      cwd: input.path || process.cwd(),
      nodir: true,
      ignore: ["node_modules/**", ".git/**"],
    });
    if (files.length === 0) return "No files found matching the pattern.";
    return files.slice(0, MAX_FILE_LIST_RESULTS).join("\n") +
      (files.length > MAX_FILE_LIST_RESULTS ? `\n... and ${files.length - MAX_FILE_LIST_RESULTS} more` : "");
  } catch (e: any) {
    return `Error listing files: ${e.message}`;
  }
}

function grepSearch(input: {
  pattern: string;
  path?: string;
  include?: string;
}): string {
  // Try ripgrep first (preferred), fallback to grep or JS implementation
  const hasRg = checkCommandAvailable("rg");
  
  if (hasRg) {
    return grepWithRipgrep(input);
  }
  
  if (!isWin && checkCommandAvailable("grep")) {
    return grepWithGnuGrep(input);
  }
  
  // Fallback to JS implementation for Windows without ripgrep
  return grepJS(input.pattern, input.path || ".", input.include);
}

function checkCommandAvailable(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { encoding: "utf-8", timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

function grepWithRipgrep(input: { pattern: string; path?: string; include?: string }): string {
  try {
    const args = [
      "--line-number",
      "--color=never",
      "--no-heading",
      "--max-count=1000",
    ];
    
    if (input.include) {
      args.push("--glob", input.include);
    }
    
    args.push(
      "--glob", "!.git",
      "--glob", "!.svn",
      "--glob", "!.hg",
      "--glob", "!.bzr",
      "--glob", "!_darcs"
    );
    
    args.push("--", input.pattern);
    args.push(input.path || ".");
    
    const result = execFileSync("rg", args, {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      timeout: 15000,
    });
    
    const lines = result.split("\n").filter(Boolean);
    const shown = lines.slice(0, MAX_GREP_RESULTS);
    return shown.join("\n") +
      (lines.length > MAX_GREP_RESULTS ? `\n... and ${lines.length - MAX_GREP_RESULTS} more matches` : "");
  } catch (e: any) {
    if (e.status === 1) return "No matches found.";
    return `Error: ${e.message}`;
  }
}

function grepWithGnuGrep(input: { pattern: string; path?: string; include?: string }): string {
  try {
    const args = ["--line-number", "--color=never", "-r"];
    if (input.include) args.push(`--include=${input.include}`);
    args.push("--", input.pattern);
    args.push(input.path || ".");
    
    const result = execFileSync("grep", args, {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      timeout: 10000,
    });
    
    const lines = result.split("\n").filter(Boolean);
    return lines.slice(0, MAX_GREP_RESULTS).join("\n") +
      (lines.length > MAX_GREP_RESULTS ? `\n... and ${lines.length - MAX_GREP_RESULTS} more matches` : "");
  } catch (e: any) {
    if (e.status === 1) return "No matches found.";
    return `Error: ${e.message}`;
  }
}

function grepJS(pattern: string, dir: string, include?: string): string {
  const re = new RegExp(pattern);
  const includeRe = include ? new RegExp(include.replace(/\*/g, ".*").replace(/\?/g, ".")) : null;
  const matches: string[] = [];

  function walk(d: string) {
    if (matches.length >= MAX_GREP_SCAN_RESULTS) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }

    for (const name of entries) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const full = join(d, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (includeRe && !includeRe.test(name)) continue;

      try {
        const text = readFileSync(full, "utf-8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            matches.push(`${full}:${i + 1}:${lines[i]}`);
            if (matches.length >= MAX_GREP_SCAN_RESULTS) return;
          }
        }
      } catch {
        // skip non-text files
      }
    }
  }

  walk(dir);
  if (matches.length === 0) return "No matches found.";
  const shown = matches.slice(0, MAX_GREP_RESULTS);
  return shown.join("\n") +
    (matches.length > MAX_GREP_RESULTS ? `\n... and ${matches.length - MAX_GREP_RESULTS} more matches` : "");
}

function runShell(input: { command: string; timeout?: number }): string {
  try {
    const result = execSync(input.command, {
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
      timeout: input.timeout || 30000,
      stdio: ["pipe", "pipe", "pipe"],
      shell: isWin ? "powershell.exe" : "/bin/sh",
    });
    return result || "(no output)";
  } catch (e: any) {
    const stderr = e.stderr ? `\nStderr: ${e.stderr}` : "";
    const stdout = e.stdout ? `\nStdout: ${e.stdout}` : "";
    return `Command failed (exit code ${e.status})${stdout}${stderr}`;
  }
}

// ─── Task management handlers ───────────────────────────────

function taskCreate(input: { subject: string; description: string; activeForm?: string }): string {
  const task = taskStore.create(input.subject, input.description, input.activeForm);
  return `Task #${task.id} created: ${task.subject}`;
}

function taskUpdate(input: {
  taskId: string;
  status?: string;
  subject?: string;
  description?: string;
  activeForm?: string;
}): string {
  const updated = taskStore.update(input.taskId, {
    status: input.status as any,
    subject: input.subject,
    description: input.description,
    activeForm: input.activeForm,
  });

  if (input.status === "deleted") {
    return `Task #${input.taskId} deleted.`;
  }
  if (!updated) {
    return `Error: Task #${input.taskId} not found.`;
  }

  const changes: string[] = [];
  if (input.status) changes.push(`status → ${input.status}`);
  if (input.subject) changes.push(`subject updated`);
  if (input.description) changes.push(`description updated`);
  if (input.activeForm) changes.push(`activeForm updated`);
  return `Task #${updated.id} updated: ${changes.join(", ") || "no changes"}`;
}

function taskList(): string {
  const tasks = taskStore.list();
  if (tasks.length === 0) return "No tasks.";

  const lines: string[] = [];
  for (const t of tasks) {
    const icon = t.status === "completed" ? "✓" : t.status === "in_progress" ? "⟳" : "○";
    lines.push(`${icon} #${t.id} [${t.status}] ${t.subject}`);
  }
  return lines.join("\n");
}

const handlers: Record<string, ToolHandler> = {
  read_file: (input) => readFile(input as { file_path: string }),
  write_file: (input) => writeFile(input as { file_path: string; content: string }),
  edit_file: (input) => editFile(input as { file_path: string; old_string: string; new_string: string }),
  list_files: (input) => listFiles(input as { pattern: string; path?: string }),
  grep_search: (input) => grepSearch(input as { pattern: string; path?: string; include?: string }),
  run_shell: (input) => runShell(input as { command: string; timeout?: number }),
  task_create: (input) => taskCreate(input as { subject: string; description: string; activeForm?: string }),
  task_update: (input) => taskUpdate(input as { taskId: string; status?: string; subject?: string; description?: string; activeForm?: string }),
  task_list: () => taskList(),
};

export async function executeToolHandler(name: string, input: ToolInput): Promise<string> {
  const handler = handlers[name];
  if (!handler) return `Unknown tool: ${name}`;
  return Promise.resolve(handler(input));
}
