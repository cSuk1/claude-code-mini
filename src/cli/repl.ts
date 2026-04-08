import * as readline from "readline";
import chalk from "chalk";
import { Agent } from "../core/agent.js";
import { printWelcome, printError, printInfo, showMenu, showQuestion, showFreeTextInput, gradientText } from "../ui/index.js";
import { discoverSkills, resolveSkillPrompt, getSkillByName, executeSkill } from "../extensions/skills.js";
import { CommandRegistry, registerBuiltinCommands } from "./commands.js";
import { generatePermissionRule, savePermissionRule } from "../tools/tools.js";

// The prompt string — must match what readline knows about so cursor math works.
const PROMPT = "\n" + gradientText("❯ ", "#7dd3fc", "#c4b5fd");

export async function runRepl(agent: Agent) {
  // ─── Build command registry ─────────────────────────────────
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry);

  // ─── Tab-completion: slash commands + skills ────────────────
  const completer = (line: string): [string[], string] => {
    // Only complete when input starts with "/"
    if (!line.startsWith("/")) {
      return [[], line];
    }

    const prefix = line.slice(1); // strip leading "/"

    // Gather built-in command completions
    const cmdHits = registry.getCompletions(prefix).map((c) => ({
      value: `/${c.name}`,
      display: `/${c.name}`.padEnd(16) + `  ${c.description}`,
    }));

    // Gather skill completions
    const skills = discoverSkills().filter(
      (s) => s.userInvocable && s.name.startsWith(prefix)
    );
    const skillHits = skills.map((s) => ({
      value: `/${s.name}`,
      display: `/${s.name}`.padEnd(16) + `  ${s.description}`,
    }));

    const allHits = [...cmdHits, ...skillHits];

    if (allHits.length === 0) {
      return [[], line];
    }

    // Single match → auto-complete with trailing space
    if (allHits.length === 1) {
      return [[allHits[0].value + " "], line];
    }

    // Multiple matches → return display strings for readline to show as a
    // list, plus the values so readline can find common prefix for
    // partial completion.  We return display strings — readline prints them
    // and then redraws the prompt + current input automatically.
    return [allHits.map((h) => h.display), line];
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
  });

  // Tell readline what our prompt is so it can correctly calculate cursor
  // position after tab-completion and Ctrl+C redraws.
  rl.setPrompt(PROMPT);

  // Provide confirmFn with interactive menu
  agent.setConfirmFn(async (toolName: string, input: Record<string, any>) => {
    // Pause readline to avoid conflicts with raw mode
    rl.pause();

    const options = [
      { label: "Allow (this time only)", value: "allow" },
      { label: "Allow, and remember for this project", value: "allow-remember" },
      { label: "Deny (this time only)", value: "deny" },
      { label: "Deny, and always deny for this project", value: "deny-remember" },
    ];

    const choice = await showMenu("Allow this action? [↑/↓ + Enter]", options);

    rl.resume();

    if (choice === "allow-remember") {
      const rule = generatePermissionRule(toolName, input);
      savePermissionRule(rule, "allow");
      printInfo(`Allowed & remembered: ${rule}`);
      return "allow";
    }

    if (choice === "deny-remember") {
      const rule = generatePermissionRule(toolName, input);
      savePermissionRule(rule, "deny");
      printInfo(`Denied & remembered: ${rule}`);
      return "deny";
    }

    if (choice === "allow") {
      return "allow";
    }

    // null (Ctrl+C / Escape) or "deny"
    return "deny";
  });

  // Provide askUserFn with interactive UI
  agent.setAskUserFn(async (question: string, options?: string[], allowFreeText?: boolean) => {
    // Pause readline to avoid conflicts with raw mode
    rl.pause();

    let answer: string;
    try {
      if (options && options.length > 0) {
        answer = await showQuestion(question, options, allowFreeText);
      } else {
        answer = await showFreeTextInput(question);
      }
    } finally {
      rl.resume();
    }

    return answer;
  });

  // Ctrl+C handling
  let sigintCount = 0;
  process.on("SIGINT", () => {
    if (agent.isProcessing) {
      agent.abort();
      console.log("\n  (interrupted)");
      sigintCount = 0;
      rl.prompt();
    } else {
      sigintCount++;
      if (sigintCount >= 2) {
        agent.destroy();
        console.log("\nBye!\n");
        process.exit(0);
      }
      console.log("\n  Press Ctrl+C again to exit.");
      rl.prompt();
    }
  });

  printWelcome(agent.model);

  // Use readline's native prompt + "line" event so that the prompt string
  // is always known to readline.  This is essential for tab-completion
  // redraws to work correctly.
  rl.on("line", async (line) => {
    const input = line.trim();
    sigintCount = 0;

    if (!input) {
      rl.prompt();
      return;
    }
    if (input === "exit" || input === "quit") {
      agent.destroy();
      console.log("\nBye!\n");
      rl.close();
      process.exit(0);
    }

    // ─── Slash command dispatch ───────────────────────────────
    if (input.startsWith("/")) {
      const spaceIdx = input.indexOf(" ");
      const cmdName = spaceIdx > 0 ? input.slice(1, spaceIdx) : input.slice(1);
      const cmdArgs = spaceIdx > 0 ? input.slice(spaceIdx + 1) : "";

      // 1. Check built-in commands from the registry
      const command = registry.get(cmdName);
      if (command) {
        await command.handler(agent, cmdArgs);
        rl.prompt();
        return;
      }

      // 2. Check user-invocable skills
      const skill = getSkillByName(cmdName);
      if (skill && skill.userInvocable) {
        printInfo(`Invoking skill: ${skill.name}`);
        try {
          if (skill.context === "fork") {
            const forkResult = executeSkill(skill.name, cmdArgs);
            if (forkResult) {
              await agent.chat(
                `Use the skill tool to invoke "${skill.name}" with args: ${cmdArgs || "(none)"}`
              );
            }
          } else {
            const resolved = resolveSkillPrompt(skill, cmdArgs);
            await agent.chat(resolved);
          }
        } catch (e: any) {
          if (e.name !== "AbortError" && !e.message?.includes("aborted")) {
            printError(e.message);
          }
        }
        rl.prompt();
        return;
      }

      // Unknown slash command — fall through to regular chat
    }

    // ─── Regular chat ─────────────────────────────────────────
    try {
      await agent.chat(input);
    } catch (e: any) {
      if (e.name === "AbortError" || e.message?.includes("aborted")) {
        // Already handled by SIGINT handler
      } else {
        printError(e.message);
      }
    }

    rl.prompt();
  });

  // Kick off the first prompt
  rl.prompt();
}
