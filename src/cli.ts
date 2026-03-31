#!/usr/bin/env node

import * as readline from "readline";
import { Agent } from "./agent.js";
import { printWelcome, printUserPrompt, printError, printInfo } from "./ui.js";
import { loadSession, getLatestSessionId } from "./session.js";

interface ParsedArgs {
  yolo: boolean;
  model: string;
  apiBase?: string;
  apiKey?: string;
  prompt?: string;
  resume?: boolean;
  thinking?: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let yolo = false;
  let thinking = false;
  let model = "claude-sonnet-4-20250514";
  let apiBase: string | undefined;
  let apiKey: string | undefined;
  let resume = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--yolo" || args[i] === "-y") {
      yolo = true;
    } else if (args[i] === "--thinking") {
      thinking = true;
    } else if (args[i] === "--model" || args[i] === "-m") {
      model = args[++i] || model;
    } else if (args[i] === "--api-base") {
      apiBase = args[++i];
    } else if (args[i] === "--api-key") {
      apiKey = args[++i];
    } else if (args[i] === "--resume") {
      resume = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
Usage: mini-claude [options] [prompt]

Options:
  --yolo, -y       Skip all confirmation prompts
  --thinking        Enable extended thinking (Anthropic only)
  --model, -m      Model to use (default: claude-sonnet-4-20250514)
  --api-base URL   Use OpenAI-compatible API endpoint
  --api-key KEY    API key for the specified endpoint
  --resume         Resume the last session
  --help, -h       Show this help

REPL commands:
  /clear           Clear conversation history
  /cost            Show token usage and cost
  /compact         Manually compact conversation

Examples:
  mini-claude "fix the bug in src/app.ts"
  mini-claude --yolo "run all tests and fix failures"
  mini-claude --api-base https://aihubmix.com/v1 --api-key sk-xxx --model gpt-4o "hello"
  mini-claude --resume
  mini-claude  # starts interactive REPL
`);
      process.exit(0);
    } else {
      positional.push(args[i]);
    }
  }

  return {
    yolo,
    model,
    apiBase,
    apiKey,
    resume,
    thinking,
    prompt: positional.length > 0 ? positional.join(" ") : undefined,
  };
}

async function runRepl(agent: Agent) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Ctrl+C handling
  let sigintCount = 0;
  process.on("SIGINT", () => {
    if (agent.isProcessing) {
      agent.abort();
      console.log("\n  (interrupted)");
      sigintCount = 0;
      printUserPrompt();
    } else {
      sigintCount++;
      if (sigintCount >= 2) {
        console.log("\nBye!\n");
        process.exit(0);
      }
      console.log("\n  Press Ctrl+C again to exit.");
      printUserPrompt();
    }
  });

  printWelcome();

  const askQuestion = (): void => {
    printUserPrompt();
    rl.once("line", async (line) => {
      const input = line.trim();
      sigintCount = 0;

      if (!input) {
        askQuestion();
        return;
      }
      if (input === "exit" || input === "quit") {
        console.log("\nBye!\n");
        rl.close();
        process.exit(0);
      }

      // REPL commands
      if (input === "/clear") {
        agent.clearHistory();
        askQuestion();
        return;
      }
      if (input === "/cost") {
        agent.showCost();
        askQuestion();
        return;
      }
      if (input === "/compact") {
        try {
          await agent.compact();
        } catch (e: any) {
          printError(e.message);
        }
        askQuestion();
        return;
      }

      try {
        await agent.chat(input);
      } catch (e: any) {
        if (e.name === "AbortError" || e.message?.includes("aborted")) {
          // Already handled by SIGINT handler
        } else {
          printError(e.message);
        }
      }

      askQuestion();
    });
  };

  askQuestion();
}

async function main() {
  const { yolo, model, apiBase, apiKey, prompt, resume, thinking } = parseArgs();

  // Determine API key: --api-key flag > env vars
  const resolvedApiKey =
    apiKey ||
    (apiBase ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY);

  if (!resolvedApiKey) {
    const envVar = apiBase ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    printError(
      `API key is required.\n` +
        `  Use --api-key flag or set ${envVar} environment variable.`
    );
    process.exit(1);
  }

  const agent = new Agent({ yolo, model, apiBase, apiKey: resolvedApiKey, thinking });

  // Resume session if requested
  if (resume) {
    const sessionId = getLatestSessionId();
    if (sessionId) {
      const session = loadSession(sessionId);
      if (session) {
        agent.restoreSession({
          anthropicMessages: session.anthropicMessages,
          openaiMessages: session.openaiMessages,
        });
      } else {
        printInfo("No session found to resume.");
      }
    } else {
      printInfo("No previous sessions found.");
    }
  }

  if (prompt) {
    // One-shot mode
    try {
      await agent.chat(prompt);
    } catch (e: any) {
      printError(e.message);
      process.exit(1);
    }
  } else {
    // Interactive REPL mode
    await runRepl(agent);
  }
}

main();
