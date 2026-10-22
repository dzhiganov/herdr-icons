import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ICON_SETS, isIconSetName, type IconSetName } from './sprites.js';

export const PLUGIN_ID = 'dima.icons';

export interface Config {
  /** Which icon set to draw. */
  set: IconSetName;
  /** Animation speed multiplier (0 = static icons). */
  speed: number;
  /** Also animate the rolled-up state of each space (workspace) in the Spaces panel. */
  spaces: boolean;
  /** Upper bound on socket requests per second; frames are dropped above it. */
  maxRequestsPerSecond: number;
}

export const DEFAULT_CONFIG: Config = { set: 'classic', speed: 1, spaces: true, maxRequestsPerSecond: 60 };

/** Herdr injects these for plugin commands; the fallbacks match herdr's defaults. */
export function configDir(): string {
  return process.env.HERDR_PLUGIN_CONFIG_DIR ?? join(homedir(), '.config', 'herdr', 'plugins', 'config', PLUGIN_ID);
}

export function stateDir(): string {
  return process.env.HERDR_PLUGIN_STATE_DIR ?? join(homedir(), '.local', 'state', 'herdr', 'plugins', PLUGIN_ID);
}

export interface ConfigResult {
  config: Config;
  /** Problems with the file; the defaults are used for those fields. */
  warnings: string[];
}

export function parseConfig(raw: unknown): ConfigResult {
  const warnings: string[] = [];
  const config = { ...DEFAULT_CONFIG };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { config, warnings: ['config must be a JSON object; using defaults'] };
  }
  const r = raw as Record<string, unknown>;
  if (r.set !== undefined) {
    if (isIconSetName(r.set)) config.set = r.set;
    else warnings.push(`set: expected one of ${Object.keys(ICON_SETS).join(', ')}`);
  }
  const number = (key: 'speed' | 'maxRequestsPerSecond', min: number, max: number) => {
    const v = r[key];
    if (v === undefined) return;
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) config[key] = v;
    else warnings.push(`${key}: expected a number from ${min} to ${max}`);
  };
  number('speed', 0, 10);
  number('maxRequestsPerSecond', 1, 1000);
  if (r.spaces !== undefined) {
    if (typeof r.spaces === 'boolean') config.spaces = r.spaces;
    else warnings.push('spaces: expected true or false');
  }
  return { config, warnings };
}

/** Read `config.json`, writing the defaults on first run. */
export function loadConfig(dir = configDir()): ConfigResult {
  const path = join(dir, 'config.json');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
    } catch {
      // read-only config dir: defaults still apply
    }
    return { config: { ...DEFAULT_CONFIG }, warnings: [] };
  }
  try {
    return parseConfig(JSON.parse(text));
  } catch (err) {
    return { config: { ...DEFAULT_CONFIG }, warnings: [`${path}: ${(err as Error).message}; using defaults`] };
  }
}
