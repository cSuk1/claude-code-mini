import chalk from "chalk";

// ━━━ StarDust Terminal — Color Palette ━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Deep-space aesthetic: cyan→violet gradient core, warm amber accents,
// subtle halftone textures. All colors use chalk for truecolor support.

export const C = {
  // ── Primary accent family (cyan → blue → violet) ──
  accent:    chalk.hex("#7dd3fc"),   // sky-300 — primary interactive
  accentDim: chalk.hex("#38bdf8").dim, // sky-400 dim — secondary hints
  brand:     chalk.hex("#c4b5fd").bold, // violet-300 bold — brand identity
  brandDim:  chalk.hex("#a78bfa"),    // violet-400 — brand secondary

  // ── Neutral / structural ──
  muted:     chalk.hex("#64748b"),    // slate-500 — de-emphasized
  mutedDim:  chalk.hex("#475569"),    // slate-600 — deep muted
  border:    chalk.hex("#334155"),    // slate-700 — structural lines
  surface:   chalk.hex("#1e293b"),    // slate-800 — background tint

  // ── Semantic ──
  success:   chalk.hex("#4ade80"),    // green-400
  warn:      chalk.hex("#fbbf24"),    // amber-400
  error:     chalk.hex("#f87171").bold, // red-400 bold
  info:      chalk.hex("#7dd3fc"),    // sky-300

  // ── Text formatting ──
  bold:      chalk.bold,
  italic:    chalk.italic,
  strike:    chalk.strikethrough,

  // ── Code & links ──
  code:      chalk.hex("#c4b5fd"),    // violet-300 — inline code
  codeDim:   chalk.hex("#818cf8"),    // indigo-400 — code punctuation
  file:      chalk.hex("#38bdf8"),    // sky-400 — file paths
  link:      chalk.hex("#7dd3fc").underline, // sky-300 underline
  linkDim:   chalk.hex("#64748b"),    // slate-500 — link URLs

  // ── Diff ──
  diffAdd:   chalk.hex("#4ade80"),    // green-400
  diffDel:   chalk.hex("#f87171"),    // red-400
  diffHunk:  chalk.hex("#818cf8"),    // indigo-400

  // ── Decorative ──
  sparkle:   chalk.hex("#e0e7ff"),    // indigo-100 — highlights, stars
  gradient1: chalk.hex("#7dd3fc"),    // sky-300 — gradient start
  gradient2: chalk.hex("#818cf8"),    // indigo-400 — gradient mid
  gradient3: chalk.hex("#c4b5fd"),    // violet-300 — gradient end
};

/**
 * Generate a horizontal gradient text effect.
 * Interpolates between two hex colors across the string.
 */
export function gradientText(text: string, from: string = "#7dd3fc", to: string = "#c4b5fd"): string {
  const chars = [...text];
  return chars.map((char, i) => {
    const t = chars.length > 1 ? i / (chars.length - 1) : 0;
    const r = Math.round(lerp(parseInt(from.slice(1, 3), 16), parseInt(to.slice(1, 3), 16), t));
    const g = Math.round(lerp(parseInt(from.slice(3, 5), 16), parseInt(to.slice(3, 5), 16), t));
    const b = Math.round(lerp(parseInt(from.slice(5, 7), 16), parseInt(to.slice(5, 7), 16), t));
    return chalk.hex(`#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`)(char);
  }).join("");
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Draw a decorative divider with gradient.
 */
export function gradientDivider(width: number = 40): string {
  const line = "─".repeat(width);
  return gradientText(line, "#334155", "#818cf8");
}
