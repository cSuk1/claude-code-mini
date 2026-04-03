import { executeToolHandler } from "./executors.js";

type ToolInput = Record<string, any>;

const MAX_RESULT_CHARS = 50000;

function shouldBypassTruncation(name: string, input: ToolInput): boolean {
  return name === "read_file" && input.limit === 0;
}

function truncateResult(result: string): string {
  if (result.length <= MAX_RESULT_CHARS) return result;
  const keepEach = Math.floor((MAX_RESULT_CHARS - 60) / 2);
  return (
    result.slice(0, keepEach) +
    "\n\n[... truncated " +
    (result.length - keepEach * 2) +
    " chars ...]\n\n" +
    result.slice(-keepEach)
  );
}

export async function executeTool(name: string, input: ToolInput): Promise<string> {
  const result = await executeToolHandler(name, input);
  if (shouldBypassTruncation(name, input)) return result;
  return truncateResult(result);
}
