import { Agent } from "../core/agent.js";
import { printInfo, printError, showMenu, showFreeTextInput } from "../ui/index.js";
import { listMemories } from "../storage/memory.js";
import { discoverSkills } from "../extensions/skills.js";
import {
  isTierName,
  setTierModel,
  getTierConfig,
  formatTierInfo,
  getModelForTier,
  type ModelTier,
} from "../core/model-tiers.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ─── Slash Command Interface ────────────────────────────────

export interface SlashCommand {
  /** Command name without the leading slash, e.g. "clear" */
  name: string;
  /** Short description shown in /help and completion dropdown */
  description: string;
  /** Usage string shown in /help, e.g. "/model [name]" */
  usage: string;
  /** Whether this command accepts arguments */
  hasArgs?: boolean;
  /** Handler — receives the Agent and any text after the command name */
  handler: (agent: Agent, args: string) => Promise<void> | void;
}

// ─── Command Registry ───────────────────────────────────────

export class CommandRegistry {
  private commands = new Map<string, SlashCommand>();

  /** Register a slash command */
  register(cmd: SlashCommand): void {
    this.commands.set(cmd.name, cmd);
  }

  /** Look up a command by name */
  get(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  /** Return all registered commands (insertion order) */
  getAll(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Return commands whose name starts with the given prefix.
   * Used for tab-completion.
   */
  getCompletions(prefix: string): SlashCommand[] {
    const lower = prefix.toLowerCase();
    return this.getAll().filter((c) => c.name.startsWith(lower));
  }
}

// ─── Built-in Commands ──────────────────────────────────────

export function registerBuiltinCommands(registry: CommandRegistry): void {
  registry.register({
    name: "help",
    description: "Show all available commands",
    usage: "/help",
    handler: (_agent, _args) => {
      const all = registry.getAll();
      const maxUsage = Math.max(...all.map((c) => c.usage.length));
      console.log("");
      console.log("  Available commands:\n");
      for (const cmd of all) {
        const padded = cmd.usage.padEnd(maxUsage + 2);
        console.log(`    ${padded} ${cmd.description}`);
      }
      console.log("");
    },
  });

  registry.register({
    name: "clear",
    description: "Clear conversation history",
    usage: "/clear",
    handler: (agent, _args) => {
      agent.clearHistory();
    },
  });

  registry.register({
    name: "compact",
    description: "Manually compact conversation",
    usage: "/compact",
    handler: async (agent, _args) => {
      try {
        await agent.compact();
      } catch (e: any) {
        printError(e.message);
      }
    },
  });

  registry.register({
    name: "model",
    description: "Show/switch model or tier (e.g. /model pro gpt-4o)",
    usage: "/model [tier] [name]",
    hasArgs: true,
    handler: (agent, args) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);

      if (parts.length === 0) {
        printInfo(`Current model: ${agent.model}`);
        console.log("");
        console.log("  Model tiers:");
        console.log(formatTierInfo());
        console.log("");
        console.log("  Usage:");
        console.log("    /model <name>            Switch current model");
        console.log("    /model <tier> <name>     Set model for tier (pro/lite/mini)");
        return;
      }

      if (parts.length >= 2 && isTierName(parts[0])) {
        const tier = parts[0] as ModelTier;
        const modelName = parts.slice(1).join(" ");
        setTierModel(tier, modelName);

        const configPath = join(homedir(), ".ccmini", "settings.json");
        let config: any = {};
        if (existsSync(configPath)) {
          try {
            config = JSON.parse(readFileSync(configPath, "utf-8"));
          } catch {
            // Ignore
          }
        }
        if (!config.models) config.models = {};
        config.models[tier] = modelName;
        mkdirSync(join(homedir(), ".ccmini"), { recursive: true });
        writeFileSync(configPath, JSON.stringify(config, null, 2));

        const cfg = getTierConfig(tier);
        printInfo(`Tier ${tier.toUpperCase()} → ${cfg.model}  [config]`);

        if (tier === "pro") {
          agent.switchModel(modelName);
          printInfo(`Active model also switched to: ${modelName}`);
        }
        return;
      }

      if (parts.length === 1 && isTierName(parts[0])) {
        const cfg = getTierConfig(parts[0] as ModelTier);
        printInfo(`Tier ${cfg.tier.toUpperCase()}: ${cfg.model}  [${cfg.source}]`);
        printInfo(cfg.description);
        return;
      }

      const newModel = parts.join(" ");
      const result = agent.switchModel(newModel);

      const configPath = join(homedir(), ".ccmini", "settings.json");
      let config: any = {};
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(readFileSync(configPath, "utf-8"));
        } catch {
          // Ignore
        }
      }
      if (!config.models) config.models = {};
      config.models.pro = newModel;
      config.models.lite = newModel;
      config.models.mini = newModel;
      mkdirSync(join(homedir(), ".ccmini"), { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      printInfo(`Switched to model: ${result.model} (saved to config)`);
      if (!result.known) {
        printInfo(
          `Warning: "${result.model}" is not a recognized model.`
        );
      }
    },
  });

  registry.register({
    name: "memory",
    description: "List saved memories",
    usage: "/memory",
    handler: (_agent, _args) => {
      const memories = listMemories();
      if (memories.length === 0) {
        printInfo("No memories saved yet.");
      } else {
        printInfo(`${memories.length} memories:`);
        for (const m of memories) {
          console.log(`    [${m.type}] ${m.name} — ${m.description}`);
        }
      }
    },
  });

  registry.register({
    name: "connect",
    description: "Connect to an API provider (type, baseUrl, apiKey, model)",
    usage: "/connect",
    handler: async (agent, _args) => {
      await runConnectFlow(agent);
    },
  });
}

interface ApiConfigInput {
  provider: "anthropic" | "openai";
  baseUrl: string;
  apiKey: string;
  proModel?: string;
  liteModel?: string;
  miniModel?: string;
}

function saveApiConfig(input: ApiConfigInput): void {
  const configPath = join(homedir(), ".ccmini", "settings.json");
  let config: any = {};

  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // Ignore malformed config
    }
  }

  config.api = {
    provider: input.provider,
    baseUrl: input.baseUrl || undefined,
    apiKey: input.apiKey || undefined,
  };

  // Use provided models or fall back to proModel for all tiers
  if (!config.models) config.models = {};
  const lite = input.liteModel || input.proModel;
  const mini = input.miniModel || lite || input.proModel;

  if (input.proModel) config.models.pro = input.proModel;
  if (input.liteModel) config.models.lite = input.liteModel;
  if (input.miniModel) config.models.mini = input.miniModel;
  // If only proModel provided, use it for all tiers (backward compatibility)
  else if (input.proModel && !input.liteModel && !input.miniModel) {
    config.models.lite = input.proModel;
    config.models.mini = input.proModel;
  }

  const dir = join(homedir(), ".ccmini");
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Legacy function for backward compatibility
function saveApiConfigWithModels(
  provider: "anthropic" | "openai",
  baseUrl: string,
  apiKey: string,
  proModel: string,
  liteModel: string,
  miniModel: string
): void {
  saveApiConfig({ provider, baseUrl, apiKey, proModel, liteModel, miniModel });
}

export async function runConnectFlow(agent?: Agent): Promise<void> {
  const choice = await showMenu(
    "Select provider type:",
    [
      { label: "Anthropic (Claude)", value: "anthropic" },
      { label: "OpenAI Compatible", value: "openai" },
    ]
  );

  if (!choice) return;

  const baseUrl = await showFreeTextInput(
    choice === "anthropic" ? "Base URL (optional)" : "Base URL"
  );

  const apiKey = await showFreeTextInput("API Key");

  const proModel = await showFreeTextInput("Pro model name");
  const liteModel = await showFreeTextInput("Lite model name (optional, press Enter to skip)");
  const miniModel = await showFreeTextInput("Mini model name (optional, press Enter to skip)");

  saveApiConfigWithModels(
    choice as "anthropic" | "openai",
    baseUrl,
    apiKey,
    proModel,
    liteModel || proModel,
    miniModel || liteModel || proModel
  );

  printInfo(`Saved configuration to ~/.ccmini/settings.json`);

  if (agent) {
    agent.switchModel(proModel);
    setTierModel("pro", proModel);
    if (liteModel) setTierModel("lite", liteModel);
    if (miniModel) setTierModel("mini", miniModel);
    printInfo(`Models updated: pro=${proModel}, lite=${liteModel || proModel}, mini=${miniModel || liteModel || proModel}`);
  }

  printInfo(`Connected to ${choice} at ${baseUrl || "(default)"}`);
}
