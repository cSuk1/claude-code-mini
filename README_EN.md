# Mini Claude Code

> Build Claude Code from scratch, step by step

[中文](./README.md)

**Recreate Claude Code's core capabilities in ~1300 lines of TypeScript.** This isn't a demo — it's a step-by-step tutorial where each chapter compares Claude Code's real source with our simplified implementation, helping you truly understand how coding agents work.

## Step-by-Step Tutorial

**[Read Online →](https://windy3f3f3f3f.github.io/claude-code-from-scratch/)**

8 chapters, from core loop to complete CLI. Each chapter includes real code + Claude Code source comparison:

| Chapter | Content | Source Mapping |
|---------|---------|---------------|
| [1. Agent Loop](https://windy3f3f3f3f.github.io/claude-code-from-scratch/#/docs/01-agent-loop) | Core loop: call LLM → execute tools → repeat | `agent.ts` ↔ `query.ts` |
| [2. Tool System](https://windy3f3f3f3f.github.io/claude-code-from-scratch/#/docs/02-tools) | 6 tools: definition & implementation | `tools.ts` ↔ `Tool.ts` + 66 tools |
| [3. System Prompt](https://windy3f3f3f3f.github.io/claude-code-from-scratch/#/docs/03-system-prompt) | Prompt engineering for a coding agent | `prompt.ts` ↔ `prompts.ts` |
| [4. Streaming](https://windy3f3f3f3f.github.io/claude-code-from-scratch/#/docs/04-streaming) | Anthropic + OpenAI dual-backend streaming | `agent.ts` ↔ `api/claude.ts` |
| [5. Safety](https://windy3f3f3f3f.github.io/claude-code-from-scratch/#/docs/05-safety) | Dangerous command detection + confirmation | `tools.ts` ↔ `permissions.ts` (52KB) |
| [6. Context](https://windy3f3f3f3f.github.io/claude-code-from-scratch/#/docs/06-context) | Result truncation + auto-compaction | `agent.ts` ↔ `compact/` |
| [7. CLI & Sessions](https://windy3f3f3f3f.github.io/claude-code-from-scratch/#/docs/07-cli-session) | REPL, Ctrl+C, session persistence | `cli.ts` ↔ `cli.tsx` |
| [8. Comparison](https://windy3f3f3f3f.github.io/claude-code-from-scratch/#/docs/08-whats-next) | Full comparison + extension ideas | Global |

## Quick Start

```bash
git clone https://github.com/Windy3f3f3f3f/claude-code-from-scratch.git
cd claude-code-from-scratch
npm install && npm run build
export ANTHROPIC_API_KEY="your-key-here"

npm start                                    # Interactive REPL
npm start -- "fix the bug in src/app.ts"     # One-shot mode
npm start -- --yolo "run tests and fix"      # Skip confirmations
npm start -- --resume                        # Restore last session
```

### OpenAI-Compatible API

```bash
npm start -- --api-base https://aihubmix.com/v1 --api-key sk-xxx --model gpt-4o "hello"
```

### REPL Commands

| Command | Function |
|---------|----------|
| `/clear` | Clear conversation history |
| `/cost` | Show cumulative token usage and cost |
| `/compact` | Manually trigger conversation compaction |

## Core Capabilities

- **Agent Loop**: Automatically calls tools, processes results, iterates until done
- **6 Core Tools**: Read, write, edit files; search files/content; execute commands
- **Streaming**: Real-time character-by-character output, Anthropic + OpenAI backends
- **Context Management**: Automatic token tracking with conversation compaction
- **Safe by Default**: Dangerous commands require confirmation; `--yolo` to skip
- **Session Persistence**: Auto-save conversations, `--resume` to restore
- **Error Recovery**: Exponential backoff retry on rate limits, graceful Ctrl+C

## Architecture

```
User Input
  │
  ▼
┌─────────────────────────────────────┐
│          Agent Loop                 │
│                                     │
│  Messages → API (stream) → Output  │
│       ▲                   │         │
│       │              ┌────┴───┐     │
│       │              │  Text  │     │
│       │              │ Tools  │     │
│       │              └────┬───┘     │
│       │                   │         │
│       │   ┌────────┐┌────▼───┐     │
│       │   │Truncate│←│Execute│     │
│       │   └────────┘└────┬───┘     │
│       │                   │         │
│       │   ┌───────────────▼───┐     │
│       └───│Token Track+Compact│     │
│           └───────────────────┘     │
└─────────────────────────────────────┘
  │
  ▼
Task Complete → Auto-save Session
```

## Comparison with Claude Code

| Aspect | Claude Code | Mini Claude Code |
|--------|------------|-----------------|
| Purpose | Production coding agent | Educational / minimal |
| Tools | 66+ built-in | 6 core tools |
| Context | 4-level compression | Token tracking + auto-compact |
| Streaming | Ink/React rendering | Native stream printing |
| Security | 5-layer permission system | Basic command confirmation |
| Code Size | 500k+ lines | ~1300 lines |

## Project Structure

```
src/
├── cli.ts      # CLI entry: args, REPL, Ctrl+C         (209 lines)
├── agent.ts    # Agent loop: streaming, retry, compact  (620 lines)
├── tools.ts    # Tool definitions: 6 tools + truncation (304 lines)
├── prompt.ts   # System prompt: template + env inject   (65 lines)
├── session.ts  # Session persistence: save/load/list    (63 lines)
└── ui.ts       # Terminal output: colors, formatting    (102 lines)
                                              Total: ~1300 lines
```

## Related Projects

- [how-claude-code-works](https://github.com/Windy3f3f3f3f/how-claude-code-works) — Deep dive into Claude Code's architecture

## License

MIT
