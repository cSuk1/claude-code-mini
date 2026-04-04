import chalk from "chalk";

export const C = {
  accent:    chalk.cyan,
  accentDim: chalk.dim.cyan,
  brand:     chalk.bold.cyan,
  muted:     chalk.dim,
  border:    chalk.dim,

  success:   chalk.green,
  warn:      chalk.yellow,
  error:     chalk.red.bold,
  info:      chalk.cyan,

  bold:      chalk.bold,
  italic:    chalk.italic,
  strike:    chalk.strikethrough,

  code:      chalk.cyan,
  file:      chalk.blue,
  link:      chalk.underline.blue,
  linkDim:   chalk.dim,

  diffAdd:   chalk.green,
  diffDel:   chalk.red,
  diffHunk:  chalk.dim.cyan,
};
