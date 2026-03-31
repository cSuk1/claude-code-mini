import chalk from "chalk";

export function printWelcome() {
  console.log(
    chalk.bold.cyan("\n  Mini Claude Code") +
      chalk.gray(" — A minimal coding agent\n")
  );
  console.log(chalk.gray("  Type your request, or 'exit' to quit."));
  console.log(chalk.gray("  Commands: /clear /cost /compact\n"));
}

export function printUserPrompt() {
  process.stdout.write(chalk.bold.green("\n> "));
}

export function printAssistantText(text: string) {
  process.stdout.write(text);
}

export function printToolCall(name: string, input: Record<string, any>) {
  const icon = getToolIcon(name);
  const summary = getToolSummary(name, input);
  console.log(chalk.yellow(`\n  ${icon} ${name}`) + chalk.gray(` ${summary}`));
}

export function printToolResult(name: string, result: string) {
  const maxLen = 500;
  const truncated =
    result.length > maxLen
      ? result.slice(0, maxLen) + chalk.gray(`\n  ... (${result.length} chars total)`)
      : result;
  const lines = truncated.split("\n").map((l) => "  " + l);
  console.log(chalk.dim(lines.join("\n")));
}

export function printError(msg: string) {
  console.error(chalk.red(`\n  Error: ${msg}`));
}

export function printConfirmation(command: string): void {
  console.log(
    chalk.yellow("\n  ⚠ Dangerous command: ") + chalk.white(command)
  );
}

export function printDivider() {
  console.log(chalk.gray("\n  " + "─".repeat(50)));
}

export function printCost(inputTokens: number, outputTokens: number) {
  const costIn = (inputTokens / 1_000_000) * 3;
  const costOut = (outputTokens / 1_000_000) * 15;
  const total = costIn + costOut;
  console.log(
    chalk.gray(
      `\n  Tokens: ${inputTokens} in / ${outputTokens} out (~$${total.toFixed(4)})`
    )
  );
}

export function printRetry(attempt: number, max: number, reason: string) {
  console.log(
    chalk.yellow(`\n  ↻ Retry ${attempt}/${max}: ${reason}`)
  );
}

export function printInfo(msg: string) {
  console.log(chalk.cyan(`\n  ℹ ${msg}`));
}

function getToolIcon(name: string): string {
  const icons: Record<string, string> = {
    read_file: "📖",
    write_file: "✏️",
    edit_file: "🔧",
    list_files: "📁",
    grep_search: "🔍",
    run_shell: "💻",
  };
  return icons[name] || "🔨";
}

function getToolSummary(name: string, input: Record<string, any>): string {
  switch (name) {
    case "read_file":
      return input.file_path;
    case "write_file":
      return input.file_path;
    case "edit_file":
      return input.file_path;
    case "list_files":
      return input.pattern;
    case "grep_search":
      return `"${input.pattern}" in ${input.path || "."}`;
    case "run_shell":
      return input.command.length > 60
        ? input.command.slice(0, 60) + "..."
        : input.command;
    default:
      return "";
  }
}
