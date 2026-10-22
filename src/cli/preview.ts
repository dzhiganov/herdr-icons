// Animated preview of every icon set. Number keys pick the set the animator uses; q quits.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir, loadConfig, type Config } from '../config.js';
import { COLORS } from '../sidebar.js';
import { frameAt, ICON_SETS, STATES, type IconSetName } from '../sprites.js';

const names = Object.keys(ICON_SETS) as IconSetName[];
let config: Config = loadConfig().config;
let saved = '';

const ESC = '\u001B[';
const color = (hex: string, text: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${ESC}38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${text}${ESC}0m`;
};
const dim = (text: string) => `${ESC}2m${text}${ESC}0m`;
const bold = (text: string) => `${ESC}1m${text}${ESC}0m`;

function render(now: number): string {
  const colW = 12;
  const lines = ['', `  ${bold('herdr-icons')} ${dim('· animated agent status icons')}`, ''];
  const header = names.map((n, i) => {
    const label = `[${i + 1}] ${n}`.padEnd(colW);
    return n === config.set ? bold(label) : dim(label);
  });
  lines.push(`  ${''.padEnd(9)}${header.join('')}`);
  lines.push('');
  for (const state of STATES) {
    const cells = names.map((n) => {
      const frame = frameAt(ICON_SETS[n][state], now, config.speed || 1);
      return `${color(COLORS[state], frame)}${''.padEnd(colW - frame.length)}`;
    });
    lines.push(`  ${dim(state.padEnd(9))}${cells.join('')}`);
    lines.push('');
  }
  lines.push(`  ${dim('1-9 use that set · q quit')}${saved ? `   ${color(COLORS.done, saved)}` : ''}`);
  // Overwrite in place (clear each line's tail) instead of clearing the screen: no flicker.
  return `${ESC}H${lines.map((l) => `${l}${ESC}K`).join('\n')}${ESC}J`;
}

function choose(index: number) {
  const name = names[index];
  if (!name) return;
  config = { ...config, set: name };
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  saved = `✓ ${name} (applies in ~3s)`;
}

const out = process.stdout;
out.write(`${ESC}?1049h${ESC}?25l`);
const restore = () => out.write(`${ESC}?25h${ESC}?1049l`);
const quit = () => {
  clearInterval(timer);
  restore();
  process.exit(0);
};
process.on('SIGTERM', quit);
process.on('SIGINT', quit);

const timer = setInterval(() => out.write(render(Date.now())), 50);

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (key: string) => {
  if (key === 'q' || key === '\u0003' || key === '\u001B') quit();
  if (/^[1-9]$/.test(key)) choose(Number(key) - 1);
});
