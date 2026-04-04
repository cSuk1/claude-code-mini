import { C } from "./colors.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;
let currentSpinnerLabel = "Thinking";

export function startSpinner(label = "Thinking") {
  if (spinnerTimer) return;
  currentSpinnerLabel = label;
  spinnerFrame = 0;
  process.stdout.write(C.muted(`\n  ${SPINNER_FRAMES[0]} ${currentSpinnerLabel}...`));
  spinnerTimer = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    process.stdout.write(`\r\x1b[K${C.muted(`  ${SPINNER_FRAMES[spinnerFrame]} ${currentSpinnerLabel}...`)}`);
  }, 80);
}

export function updateSpinnerLabel(label: string) {
  if (!spinnerTimer) return;
  currentSpinnerLabel = label;
}

export function stopSpinner() {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    process.stdout.write("\r\x1b[K");
  }
}
