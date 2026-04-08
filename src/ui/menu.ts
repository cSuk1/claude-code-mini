import { C, gradientText } from "./colors.js";

export interface MenuOption {
  label: string;
  value: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Interactive Menu — Gradient-styled selection with smooth navigation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function showMenu(title: string, options: MenuOption[]): Promise<string | null> {
  if (options.length === 0) return null;

  const totalLines = 1 + options.length;

  return new Promise((resolve) => {
    let selected = 0;
    let resolved = false;
    let firstRender = true;

    const wasRaw = process.stdin.isRaw;

    const savedKeypressListeners = process.stdin.listeners("keypress").slice();
    process.stdin.removeAllListeners("keypress");

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      process.stdin.off("data", onData);
      if (process.stdin.isTTY && wasRaw !== undefined) {
        process.stdin.setRawMode(wasRaw);
      }
      process.stdin.pause();
      for (const fn of savedKeypressListeners) {
        process.stdin.on("keypress", fn as (...args: any[]) => void);
      }
      for (let i = 0; i < totalLines; i++) {
        process.stdout.write("\x1b[1A\x1b[2K");
      }
    };

    const render = () => {
      if (!firstRender) {
        for (let i = 0; i < totalLines; i++) {
          process.stdout.write("\x1b[1A\x1b[2K");
        }
      }
      firstRender = false;

      // Title with gradient accent
      const titleGradient = gradientText(`  ◈ ${title}`, "#7dd3fc", "#c4b5fd");
      console.log(titleGradient);
      options.forEach((opt, i) => {
        if (i === selected) {
          // Selected item — full accent with indicator
          const indicator = gradientText("  ▸ ", "#7dd3fc", "#818cf8");
          const num = C.brand(`${i + 1}. `);
          console.log(indicator + num + C.bold(opt.label));
        } else {
          // Unselected item — muted
          const indicator = C.mutedDim("    ");
          const num = C.mutedDim(`${i + 1}. `);
          console.log(indicator + num + C.muted(opt.label));
        }
      });
    };

    const onData = (data: Buffer) => {
      const key = data.toString();

      if (key === "\x03" || key === "\x1b") {
        cleanup();
        resolve(null);
        return;
      }

      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(options[selected].value);
        return;
      }

      if (key === "\x1b[A" || key === "k") {
        selected = (selected - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key === "\x1b[B" || key === "j") {
        selected = (selected + 1) % options.length;
        render();
        return;
      }

      const num = parseInt(key);
      if (num >= 1 && num <= options.length) {
        selected = num - 1;
        render();
      }
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on("data", onData);

    render();
  });
}

export async function showQuestion(question: string, options: string[], allowFreeText?: boolean): Promise<string> {
  const menuOptions: MenuOption[] = options.map((opt) => ({ label: opt, value: opt }));

  if (allowFreeText) {
    menuOptions.push({ label: "✎ Enter custom answer", value: "__free_text__" });
  }

  const choice = await showMenu(question, menuOptions);

  if (choice === null) {
    return "";
  }

  if (choice === "__free_text__") {
    return await showFreeTextInput(question);
  }

  return choice;
}

export async function showFreeTextInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw;
    const savedKeypressListeners = process.stdin.listeners("keypress").slice();
    process.stdin.removeAllListeners("keypress");

    const cleanup = () => {
      process.stdin.off("data", onData);
      if (process.stdin.isTTY && wasRaw !== undefined) {
        process.stdin.setRawMode(wasRaw);
      }
      for (const fn of savedKeypressListeners) {
        process.stdin.on("keypress", fn as (...args: any[]) => void);
      }
      if (process.stdin.isPaused()) {
        process.stdin.resume();
      }
    };

    let input = "";

    const render = () => {
      const promptGradient = gradientText(`  ◈ ${prompt}`, "#7dd3fc", "#c4b5fd");
      process.stdout.write(`\r\x1b[K${promptGradient}${C.muted(": ")}${C.accent(input)}`);
    };

    const onData = (data: Buffer) => {
      const chunk = data.toString();

      if (chunk === "\x03" || chunk === "\x1b") {
        cleanup();
        resolve("");
        return;
      }

      if (chunk === "\r" || chunk === "\n") {
        cleanup();
        console.log("");
        resolve(input);
        return;
      }

      if (chunk === "\x7f" || chunk === "\b") {
        input = input.slice(0, -1);
        render();
        return;
      }

      input += chunk;
      render();
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on("data", onData);

    console.log(gradientText(`  ◈ ${prompt}:`, "#7dd3fc", "#c4b5fd"));
    render();
  });
}
