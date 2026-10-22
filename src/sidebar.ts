import { homedir } from 'node:os';
import { join } from 'node:path';
import { tokenFor } from './animator.js';
import { STATES, type AgentState } from './sprites.js';

/** Default icon colors (Catppuccin Mocha, herdr's default theme). */
export const COLORS: Record<AgentState, string> = {
  working: '#f9e2af',
  blocked: '#f38ba8',
  done: '#a6e3a1',
  idle: '#89b4fa',
  unknown: '#6c7086',
};

const BEGIN = '# >>> herdr-icons';
const END = '# <<< herdr-icons';

export function herdrConfigPath(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'herdr', 'config.toml');
}

/** The five icon tokens, each with its own color. Only one has a value at a time. */
function iconTokens(): string {
  return STATES.map((s) => `{ token = "$${tokenFor(s)}", fg = "${COLORS[s]}" }`).join(', ');
}

/** herdr's default rows (0.9.5) with `state_icon` swapped for the animated icons. */
export function sidebarBlock(spaces: boolean): string {
  const icons = iconTokens();
  const lines = [
    `${BEGIN} (written by the dima.icons plugin; delete this block to undo)`,
    '[ui.sidebar.agents]',
    'rows = [',
    `  [${icons}, "machine", "workspace", "tab"],`,
    '  ["agent"],',
    ']',
  ];
  if (spaces) {
    lines.push('', '[ui.sidebar.spaces]', 'rows = [', `  [${icons}, "workspace"],`, '  ["branch", "git_status"],', ']');
  }
  lines.push(END);
  return lines.join('\n');
}

function blockRange(toml: string): [number, number] | null {
  const start = toml.indexOf(BEGIN);
  if (start < 0) return null;
  const endAt = toml.indexOf(END, start);
  if (endAt < 0) return null;
  let end = endAt + END.length;
  if (toml[end] === '\n') end++;
  return [start, end];
}

/** `toml` without our block. */
export function removeBlock(toml: string): string {
  const range = blockRange(toml);
  if (!range) return toml;
  const before = toml.slice(0, range[0]).replace(/\n+$/, '\n');
  const after = toml.slice(range[1]);
  const out = before + after;
  return out === '\n' ? '' : out;
}

/**
 * TOML with comments and string values removed, quoted keys unquoted, and
 * whitespace around dots collapsed: what is left are key paths and punctuation.
 */
export function keyText(toml: string): string {
  let out = '';
  let i = 0;
  let inValue = false; // after `=` on a line, strings are values, not keys
  while (i < toml.length) {
    const ch = toml[i]!;
    if (ch === '\n') {
      inValue = false;
      out += ch;
      i++;
    } else if (ch === '#') {
      while (i < toml.length && toml[i] !== '\n') i++;
    } else if (ch === '"' || ch === "'") {
      const triple = toml.startsWith(ch.repeat(3), i);
      const close = triple ? ch.repeat(3) : ch;
      let j = i + close.length;
      while (j < toml.length && !toml.startsWith(close, j)) j += ch === '"' && toml[j] === '\\' ? 2 : 1;
      const body = toml.slice(i + close.length, j);
      out += inValue ? '""' : body;
      i = j + close.length;
    } else {
      if (ch === '=') inValue = true;
      out += ch;
      i++;
    }
  }
  return out.replace(/\s*\.\s*/g, '.');
}

/**
 * Sidebar layouts the user wrote themselves (outside our block). Errs on the side
 * of a conflict: any `sidebar` key path that mentions the panel counts, however it
 * is spelled (`[ui.sidebar.agents]`, `sidebar.agents.rows = …`, `[ui.sidebar]` +
 * `agents = { … }`, inline tables, quoted keys…). A false alarm only means the
 * block is printed instead of written.
 */
export function conflicts(toml: string, spaces: boolean): string[] {
  const text = keyText(removeBlock(toml));
  if (!/\bsidebar\b/.test(text)) return [];
  const panels = spaces ? ['agents', 'spaces'] : ['agents'];
  return panels.filter((p) => new RegExp(`\\b${p}\\b`).test(text)).map((p) => `[ui.sidebar.${p}]`);
}

export type SetupResult =
  | { ok: true; toml: string; changed: boolean }
  | { ok: false; conflicts: string[]; snippet: string };

/** Add (or refresh) our block. Refuses when the user already has their own sidebar rows. */
export function applyBlock(toml: string, spaces: boolean): SetupResult {
  const found = conflicts(toml, spaces);
  const block = sidebarBlock(spaces);
  if (found.length > 0) return { ok: false, conflicts: found, snippet: block };
  const base = removeBlock(toml);
  const sep = base === '' ? '' : base.endsWith('\n\n') ? '' : base.endsWith('\n') ? '\n' : '\n\n';
  const next = `${base}${sep}${block}\n`;
  return { ok: true, toml: next, changed: next !== toml };
}
