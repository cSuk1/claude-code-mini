# Codebase Guide for Claude Code - Mini

## Build, Lint & Test Commands

- `npm run build` - Compile TypeScript to `dist/` and copy templates
- `npm run dev` - Build and run interactively (REPL mode)
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
- **File names**: kebab-case for modules (`compress.ts`, `agent-model.ts`)

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
  description: "Read file contents with line numbers...",
  input_schema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "The path to the file" },
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

#### Backend Abstraction
- **MessageHandler**: Interface for backend implementations
- **AnthropicBackend**: Handles Anthropic API streaming
- **OpenAIBackend**: Handles OpenAI-compatible API streaming
- Backend determines message format for tool results

#### Compression Pipeline (`compress.ts`)
- 3 tiers: budget → snip → microcompact
- Zero-API-cost, operates on local message array
- Separate methods for Anthropic vs OpenAI message formats

#### Sub-Agent Isolation
- Forked `Agent` instances with filtered tool sets
- Own message history, isolated state
- Permission mode always `bypassPermissions` for sub-agents

#### Tier Routing
- pro (main) → lite (sub-agents) → mini (summary)
- Based on `model-tiers.ts`

#### Permission System
- Mode-aware checks (`default`, `plan`, `acceptEdits`, etc.)
- Dangerous command regex detection
- Path confirmation caching

### Code Organization

```
src/
├── agent/                      # Main orchestration
│   └── agent.ts              # Agent class (~450 lines)
│
├── backend/                   # API backends
│   ├── backend-types.ts      # MessageHandler interface
│   ├── anthropic-backend.ts  # Anthropic implementation
│   ├── openai-backend.ts     # OpenAI implementation
│   └── index.ts              # Barrel export
│
├── core/                      # Core utilities
│   ├── agent.ts              # Main Agent class
│   ├── agent-model.ts        # Model config, context windows
│   ├── agent-retry.ts        # Retry logic
│   ├── compress.ts           # CompressionPipeline
│   ├── model-tiers.ts        # Tier routing
│   ├── prompt.ts             # System prompts
│   └── task-store.ts         # Task state
│
├── tools/                     # Tool system
│   ├── definitions.ts         # Tool schemas
│   ├── executors.ts           # Tool implementations
│   ├── permissions.ts         # Permission rules
│   ├── dispatcher.ts          # Tool dispatch
│   └── tools.ts               # Barrel export
│
├── ui/                        # Terminal UI
│   ├── colors.ts              # Chalk color constants
│   ├── spinner.ts             # Loading animation
│   ├── markdown.ts            # Markdown rendering
│   ├── menu.ts                # Interactive menus
│   ├── output.ts              # Output functions
│   └── index.ts              # Barrel export
│
├── storage/                   # Persistence
│   ├── session.ts             # Session save/load
│   └── memory.ts              # Project memory
│
├── extensions/                # Extensions
│   ├── skills.ts              # Skill discovery
│   └── subagent.ts           # Sub-agent config
│
└── cli/                       # CLI
    ├── args.ts               # Argument parsing
    ├── commands.ts           # Slash commands
    ├── config.ts             # API config
    ├── repl.ts               # Interactive REPL
    └── cli.ts                # Entry point
```

### Console Output
- Use `chalk` via `ui/colors.ts` (`C.accent`, `C.muted`, etc.)
- Functions: `printInfo()`, `printError()`, `printWarning()`, `printDivider()`, `printConfirmation()`
- Spinners: `startSpinner()`, `stopSpinner()`, `updateSpinnerLabel()`
- Markdown: `flushMarkdown()`, `resetMarkdown()`

### Files to Reference
- `src/core/agent.ts` - Agent class, chat loop
- `src/backend/anthropic-backend.ts` - Anthropic streaming
- `src/backend/openai-backend.ts` - OpenAI streaming
- `src/core/compress.ts` - Compression pipeline
- `src/tools/definitions.ts` - Tool schemas
- `src/tools/permissions.ts` - Permission modes
- `src/cli/repl.ts` - Interactive REPL

### Testing
- No Jest/Mocha configured
- Validate with `npx tsc --noEmit`
- Test manually via `npm run dev` in REPL mode
