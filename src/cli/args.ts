import type { PermissionMode } from "../tools/tools.js";

export interface ParsedArgs {
  permissionMode: PermissionMode;
  model: string;
  apiBase?: string;
  prompt?: string;
  resume?: boolean;
  thinking?: boolean;
  maxTurns?: number;
}

function printHelp(): void {
  console.log(`
Usage: claude-code-mini [options] [prompt]

Options:
  --yolo, -y          Skip all confirmation prompts (bypassPermissions mode)
  --plan              Plan mode: read-only, describe changes without executing
  --accept-edits      Auto-approve file edits, still confirm dangerous shell
  --dont-ask          Auto-deny anything needing confirmation (for CI)
  --thinking          Enable extended thinking (Anthropic only)
  --model, -m         Model to use (default: claude-opus-4-6, or MINI_CLAUDE_MODEL env)
  --api-base URL      Use OpenAI-compatible API endpoint (key via env var)
  --resume            Resume the last session
  --max-turns N       Stop after N agentic turns
  --help, -h          Show this help

REPL commands:
  /help               Show all available commands
  /clear              Clear conversation history
  /compact            Manually compact conversation
  /model [tier] [name] Show/switch model or tier (pro/lite/mini)
  /memory             List saved memories
  /skills             List available skills
  /<skill-name>       Invoke a skill (e.g. /commit "fix types")

  Tip: Type / then press Tab to see all available commands.

Examples:
  claude-code-mini "fix the bug in src/app.ts"
  claude-code-mini --yolo "run all tests and fix failures"
  claude-code-mini --plan "how would you refactor this?"
  claude-code-mini --accept-edits "add error handling to api.ts"
  OPENAI_API_KEY=sk-xxx claude-code-mini --api-base https://aihubmix.com/v1 --model gpt-4o "hello"
  claude-code-mini --resume
  claude-code-mini  # starts interactive REPL
`);
}

export function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let permissionMode: PermissionMode = "default";
  let thinking = false;
  let model = process.env.MINI_CLAUDE_MODEL || "claude-opus-4-6";
  let apiBase: string | undefined;
  let resume = false;
  let maxTurns: number | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--yolo" || args[i] === "-y") {
      permissionMode = "bypassPermissions";
    } else if (args[i] === "--plan") {
      permissionMode = "plan";
    } else if (args[i] === "--accept-edits") {
      permissionMode = "acceptEdits";
    } else if (args[i] === "--dont-ask") {
      permissionMode = "dontAsk";
    } else if (args[i] === "--thinking") {
      thinking = true;
    } else if (args[i] === "--model" || args[i] === "-m") {
      model = args[++i] || model;
    } else if (args[i] === "--api-base") {
      apiBase = args[++i];
    } else if (args[i] === "--resume") {
      resume = true;
    } else if (args[i] === "--max-turns") {
      const v = parseInt(args[++i], 10);
      if (!isNaN(v)) maxTurns = v;
    } else if (args[i] === "--help" || args[i] === "-h") {
      printHelp();
      process.exit(0);
    } else {
      positional.push(args[i]);
    }
  }

  return {
    permissionMode,
    model,
    apiBase,
    resume,
    thinking,
    maxTurns,
    prompt: positional.length > 0 ? positional.join(" ") : undefined,
  };
}
