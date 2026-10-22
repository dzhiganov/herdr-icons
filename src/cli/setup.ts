// `node dist/cli/setup.js [--remove] [--print]`: put the animated icons into herdr's sidebar rows.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from '../config.js';
import { createClient } from '../herdr.js';
import { applyBlock, herdrConfigPath, removeBlock, sidebarBlock } from '../sidebar.js';

const args = new Set(process.argv.slice(2));
const { config } = loadConfig();

if (args.has('--print')) {
  console.log(sidebarBlock(config.spaces));
  process.exit(0);
}

const request = createClient();
async function notify(title: string, body?: string) {
  if (!process.env.HERDR_ENV) return;
  try {
    await request('notification.show', { title, ...(body ? { body } : {}) });
  } catch {
    // best effort
  }
}

const path = herdrConfigPath();
const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
let next: string;

if (args.has('--remove')) {
  next = removeBlock(current);
} else {
  const result = applyBlock(current, config.spaces);
  if (!result.ok) {
    console.error(`${path} already has its own ${result.conflicts.join(' and ')} rows, so it was left alone.`);
    console.error('Replace "state_icon" in those rows with the icon tokens, for example:\n');
    console.error(result.snippet);
    await notify('herdr-icons: sidebar not changed', `${path} already defines ${result.conflicts.join(', ')}. Run \`npm run setup-sidebar -- --print\` in the plugin folder.`);
    process.exit(1);
  }
  next = result.toml;
}

if (next === current) {
  console.log(`${path} is already up to date`);
} else {
  mkdirSync(dirname(path), { recursive: true });
  if (current) copyFileSync(path, `${path}.bak`);
  writeFileSync(path, next);
  console.log(`${args.has('--remove') ? 'Removed the icons from' : 'Updated'} ${path}${current ? ` (backup: ${path}.bak)` : ''}`);
}

try {
  const result = (await request('server.reload_config', {})) as { diagnostics?: unknown[] };
  const problems = result.diagnostics ?? [];
  if (problems.length > 0) console.error('herdr reported config problems:', JSON.stringify(problems, null, 2));
  else console.log('herdr config reloaded');
  await notify(args.has('--remove') ? 'herdr-icons removed from the sidebar' : 'herdr-icons added to the sidebar');
} catch {
  console.log('herdr is not running; the new rows apply on its next start');
}
