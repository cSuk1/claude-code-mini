#!/usr/bin/env node

import { Agent } from "./core/agent.js";
import { printError, printInfo } from "./ui/ui.js";
import { loadSession, getLatestSessionId } from "./storage/session.js";
import { parseArgs } from "./cli/args.js";
import { resolveApiConfig } from "./cli/config.js";
import { runRepl } from "./cli/repl.js";
import { initModelTiers } from "./core/model-tiers.js";

async function main() {
  const args = parseArgs();
  const { permissionMode, model, prompt, resume, thinking, maxCost, maxTurns } = args;
  const { apiBase, apiKey, useOpenAI } = resolveApiConfig(args);

  // Initialize model tier system (loads config files + env vars)
  initModelTiers();

  const agent = new Agent({
    permissionMode, model, thinking, maxCostUsd: maxCost, maxTurns,
    apiBase: useOpenAI ? apiBase : undefined,
    anthropicBaseURL: !useOpenAI ? apiBase : undefined,
    apiKey,
  });

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
