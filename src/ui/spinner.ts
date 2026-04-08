import chalk from "chalk";
import { C, gradientText } from "./colors.js";

// ━━━ StarDust Spinner ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Multi-phase orbital animation with gradient color cycling.
// Phase 1: Orbital dots expanding → Phase 2: Pulse contraction → repeat

const ORBITAL_FRAMES = [
  "◉       ",
  " ◉      ",
  "  ◉     ",
  "   ◉    ",
  "    ◉   ",
  "     ◉  ",
  "      ◉ ",
  "       ◉",
  "      ◉ ",
  "     ◉  ",
  "    ◉   ",
  "   ◉    ",
  "  ◉     ",
  " ◉      ",
];

const PULSE_FRAMES = [
  "○◎◎○",
  "◎◉◉◎",
  "◉●●◉",
  "◎◉◉◎",
];

const FRAMES = [...ORBITAL_FRAMES, ...ORBITAL_FRAMES.map(f => f.trimStart().padStart(8)), ...PULSE_FRAMES, ...PULSE_FRAMES.reverse()];

// Color palette for cycling through spinner frames
const SPINNER_COLORS = [
  "#7dd3fc", // sky-300
  "#93c5fd", // blue-300
  "#a5b4fc", // indigo-300
  "#c4b5fd", // violet-300
  "#d8b4fe", // purple-300
  "#c4b5fd", // violet-300
  "#a5b4fc", // indigo-300
  "#93c5fd", // blue-300
];

let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;
let currentSpinnerLabel = "Thinking";
let dotPhase = 0;
const DOT_CYCLE = ["  ", ". ", "..", "..."];

export function startSpinner(label = "Thinking") {
  if (spinnerTimer) return;
  currentSpinnerLabel = label;
  spinnerFrame = 0;
  dotPhase = 0;

  const renderFrame = () => {
    const frame = FRAMES[spinnerFrame % FRAMES.length];
    const colorIdx = spinnerFrame % SPINNER_COLORS.length;
    const color = SPINNER_COLORS[colorIdx];
    const dots = DOT_CYCLE[dotPhase % DOT_CYCLE.length];

    // Frame icon with cycling color
    const icon = chalk.hex(color)(frame);
    // Label with subtle accent
    const labelStr = C.accent(currentSpinnerLabel);
    // Animated dots
    const dotsStr = C.mutedDim(dots);

    process.stdout.write(`\r\x1b[K  ${icon} ${labelStr}${dotsStr}`);
  };

  renderFrame();

  spinnerTimer = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % FRAMES.length;
    // Animate dots every 3 frames
    if (spinnerFrame % 3 === 0) {
      dotPhase = (dotPhase + 1) % DOT_CYCLE.length;
    }
    renderFrame();
  }, 100);
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
