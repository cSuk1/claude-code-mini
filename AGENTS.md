# Codebase Guide for Claude Code - Mini

## Build, Lint & Test Commands

- `npm run build` - Compile TypeScript to `dist/` and copy templates
- `npm run dev` - Build and run interactively (rePL mode)
- `npm start` / `node dist/cli.js` - Run compiled CLI
- `node dist/cli.js --help` - Show CLI help flags
- `node dist/cli.js --model <name>` - Use specific model
- `node dist/cli.js --permission <mode>` - Set permission mode (default, plan, acceptEdits, bypassPermissions, dontAsk)
- `node dist/cli.js -p <prompt>` - One-shot prompt mode (no REPL)
- Validate changes: `npx tsc --noEmit`

## Code Style & Conventions

### Language & Target
- TypeScript ES2022, strict mode, ESM modules
- All imports use explicit `.js` extensions (Node ESM requirement)
- Compile target: ES2022, module: ESNext (bundler resolver)

### Imports
```typescript
import { Agent } from "./core/agent.js";
import chalk from "chalk";
import type Anthropic from "@anthropic-ai/sdk";
```
- Order: ESM imports → type imports → third-party → local
- No namespace imports unless needed
- Always use `.js` extension even for local files

### Naming Conventions
- **Classes**: PascalCase (`Agent`, `CommandRegistry`, `TaskStore`)
- **Functions/Methods**: camelCase (`chatAnthropic`, `executeToolCall`)
- **Constants**: UPPER_SNAKE_CASE (`SNIP_THRESHOLD`, `MICROCOMPACT_IDLE_MS`)
- **Private members**: prefix with `_` (`_model`, `lastInputTokenCount`)
- **File names**: kebab-case for modules (`agent-compression.ts`), PascalCase for entry points

### Types & Interfaces
```typescript
interface AgentOptions {
  permissionMode?: PermissionMode;
  model?: string;
  [key: string]: any;
}

type ToolDef = Anthropic.Tool;
type PermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions" | "dontAsk";
```
- Prefer `interface` over `type` for object shapes
- Use union types for finite sets (`"default" | "plan"`)
- Type all function parameters; infer return types when obvious
- Use `any` sparingly; prefer `{ [key: string]: any }` for dynamic objects

### Error Handling
```typescript
try {
  await agent.chat(prompt);
} catch (e: any) {
  if (e.name === "AbortError" || e.message?.includes("aborted")) {
    // Already handled
  } else {
    printError(e.message);
  }
}
```
- Catch with `e: any` (TypeScript strictness)
- Distinguish `AbortError` for cancellations
- Use guard clauses (`if (...) return`)
- Always `throw` unexpected errors up
- Never silently ignore errors

### Tool Definitions
```typescript
export const toolDefinitions: ToolDef[] = [{
  name: "read_file",
  description: "Read file contents...",
  input_schema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "The path..." },
    },
    required: ["file_path"],
  },
}];
```
- Follow Anthropic `input_schema` format as canonical
- `description` should be clear, concise, action-oriented
- `input_schema` properties need descriptive `description`
- `required` array lists mandatory fields

### Architecture Patterns
- **Dual-Backend**: Separate message arrays for Anthropic/OpenAI (`anthropicMessages`, `openaiMessages`)
- **Compresson Pipeline**: 4 tiers (budget → snip → microcompact → auto-compact) before each API call
- **Sub-Agent Isolation**: Forked `Agent` instances with filtered tool sets, own message history
- **Tier Routing**: pro (main) → lite (sub-agents) → mini (summary) based on `model-tiers.ts`
- **Permission System**: Mode-aware checks (`default`, `plan`, `acceptEdits`, etc.), dangerous command regex detection

### Code Organization
- **Entry**: `src/cli.ts` → `parseArgs()` → `resolveApiConfig()` → `Agent` → `runRepl()`
- **Core**: `core/agent.ts` (chat loop), `core/model-tiers.ts` (tier routing), `core/prompt.ts` (system prompt)
- **Tools**: `tools/definitions.ts` (tool schema), `tools/executors.ts` (implementations), `tools/permissions.ts` (rules)
- **Extensions**: `extensions/skills.ts` (skill discovery), `extensions/subagent.ts` (sub-agent config)
- **UI**: `ui/ui.ts` (terminal colors, spinners, markdown, prompts)
- **Storage**: `storage/session.ts` (persistence), `storage/memory.ts` (per-project memory)

### Console Output
- Use `chalk` for colors (`chalk.bold.cyanBright`, `chalk.dim`)
- Functions: `printInfo()`, `printError()`, `printWarning()`, `printDivider()`, `printConfirmation()`
- Spinners: `startSpinner()`, `stopSpinner()`, `updateSpinnerLabel()`
- Markdown rendering via `flushMarkdown()`, `resetMarkdown()`

### Files to Reference
- `src/core/agent.ts:1` - Heart of the system, chat loop
- `src/tools/definitions.ts:1` - Tool schemas (Anthropic format)
- `src/tools/permissions.ts:1` - Permission modes, dangerous command detection
- `src/cli/commands.ts` - Slash command registry
- `src/cli/repl.ts:1` - Interactive REPL with tab completion
- `src/extensions/subagent.ts:1` - Sub-agent types (explore, plan, compact, general)

### No Test Framework Yet
- No Jest/Mocha configured. Validate manually or add `npx tsc --noEmit`.
- Plan mode: test `npm run dev` in REPL mode.
