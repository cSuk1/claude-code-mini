#!/usr/bin/env node

import { Agent } from "./core/agent.js";
import { printError, printInfo } from "./ui/index.js";
import { loadSession, getLatestSessionId } from "./storage/session.js";
import { parseArgs } from "./cli/args.js";
import { resolveApiConfig } from "./cli/config.js";
import { runRepl } from "./cli/repl.js";
import { initModelTiers } from "./core/model-tiers.js";
import { runConnectFlow } from "./cli/commands.js";
import { MCPClientManager, loadMCPConfigs } from "./mcp/index.js";

// Track agent for graceful shutdown
let agent: Agent | undefined;

async function gracefulShutdown(signal: string): Promise<void> {
  if (agent) {
    agent.destroy();
    agent = undefined;
  }
  printInfo(`\nReceived ${signal}, shutting down gracefully.`);
  process.exit(0);
}

function registerShutdownHandlers(): void {
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("beforeExit", () => {
    if (agent) {
      agent.destroy();
      agent = undefined;
    }
  });
}

async function main() {
  registerShutdownHandlers();

  const args = parseArgs();

  if (args.connect) {
    await runConnectFlow();
    process.exit(0);
  }

  const { permissionMode, model, prompt, resume, thinking, maxTurns } = args;
  const { apiBase, apiKey, useOpenAI } = resolveApiConfig(args);

  initModelTiers();

  // Initialize MCP servers from config
  const mcpManager = new MCPClientManager();
  const mcpConfigs = loadMCPConfigs();
  if (Object.keys(mcpConfigs).length > 0) {
    await mcpManager.init(mcpConfigs);
  }

  agent = new Agent({
    permissionMode, model, thinking, maxTurns,
    apiBase: useOpenAI ? apiBase : undefined,
    anthropicBaseURL: !useOpenAI ? apiBase : undefined,
    apiKey,
    mcpManager,
  });

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
    try {
      await agent.chat(prompt);
    } catch (e: any) {
      printError(e.message);
      process.exit(1);
    } finally {
      agent.destroy();
      agent = undefined;
    }
  } else {
    await runRepl(agent);
  }
}

main().catch((e) => {
  printError(e.message);
  process.exit(1);
});
