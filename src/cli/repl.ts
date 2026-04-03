import * as readline from "readline";
import { Agent } from "../core/agent.js";
import { printWelcome, printUserPrompt, printError, printInfo } from "../ui/ui.js";
import { listMemories } from "../storage/memory.js";
import { discoverSkills, resolveSkillPrompt, getSkillByName, executeSkill } from "../extensions/skills.js";

export async function runRepl(agent: Agent) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Provide confirmFn that reuses this readline instance, avoiding the
  // classic Node.js bug where a second readline on the same stdin kills
  // the first one when closed.
  agent.setConfirmFn((_message: string) => {
    return new Promise((resolve) => {
      rl.question("  Allow? (y/n): ", (answer) => {
        resolve(answer.toLowerCase().startsWith("y"));
      });
    });
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

  printWelcome(agent.model);

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
      if (input === "/model" || input.startsWith("/model ")) {
        const newModel = input.slice(7).trim();
        if (!newModel) {
          printInfo(`Current model: ${agent.model}`);
        } else {
          const result = agent.switchModel(newModel);
          printInfo(`Switched to model: ${result.model}`);
          if (!result.known) {
            printInfo(`Warning: "${result.model}" is not a recognized model. Make sure the model name is correct and your API backend supports it.`);
          }
        }
        askQuestion();
        return;
      }
      if (input === "/memory") {
        const memories = listMemories();
        if (memories.length === 0) {
          printInfo("No memories saved yet.");
        } else {
          printInfo(`${memories.length} memories:`);
          for (const m of memories) {
            console.log(`    [${m.type}] ${m.name} — ${m.description}`);
          }
        }
        askQuestion();
        return;
      }
      if (input === "/skills") {
        const skills = discoverSkills();
        if (skills.length === 0) {
          printInfo("No skills found. Add skills to .claude/skills/<name>/SKILL.md");
        } else {
          printInfo(`${skills.length} skills:`);
          for (const s of skills) {
            const tag = s.userInvocable ? `/${s.name}` : s.name;
            console.log(`    ${tag} (${s.source}) — ${s.description}`);
          }
        }
        askQuestion();
        return;
      }

      // Skill invocation: /<skill-name> [args]
      if (input.startsWith("/")) {
        const spaceIdx = input.indexOf(" ");
        const cmdName = spaceIdx > 0 ? input.slice(1, spaceIdx) : input.slice(1);
        const cmdArgs = spaceIdx > 0 ? input.slice(spaceIdx + 1) : "";
        const skill = getSkillByName(cmdName);
        if (skill && skill.userInvocable) {
          printInfo(`Invoking skill: ${skill.name}`);
          try {
            if (skill.context === "fork") {
              // Fork mode: use skill tool which creates a sub-agent
              const forkResult = executeSkill(skill.name, cmdArgs);
              if (forkResult) {
                await agent.chat(`Use the skill tool to invoke "${skill.name}" with args: ${cmdArgs || "(none)"}`);
              }
            } else {
              // Inline mode: inject resolved prompt
              const resolved = resolveSkillPrompt(skill, cmdArgs);
              await agent.chat(resolved);
            }
          } catch (e: any) {
            if (e.name !== "AbortError" && !e.message?.includes("aborted")) {
              printError(e.message);
            }
          }
          askQuestion();
          return;
        }
        // Unknown command — treat as regular input
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
