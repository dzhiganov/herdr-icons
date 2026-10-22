// `node dist/cli/control.js start|stop|restart|status|preview`: manage the animator outside the startup hook.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_ID, stateDir } from '../config.js';
import { createClient, socketPath } from '../herdr.js';
import { readLock } from '../lock.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const daemonScript = join(dirname(fileURLToPath(import.meta.url)), 'daemon.js');

async function notify(title: string, body?: string) {
  if (!process.env.HERDR_ENV) return; // only inside herdr: from a shell, stdout is enough
  try {
    await createClient()('notification.show', { title, ...(body ? { body } : {}) });
  } catch {
    // best effort
  }
}

const socket = socketPath();
const lock = () => readLock(socket, stateDir());

/** 'stopped', 'not-running', or 'stuck' when it is still alive after 10s. */
async function stop(): Promise<'stopped' | 'not-running' | 'stuck'> {
  const held = lock();
  if (!held) return 'not-running';
  try {
    process.kill(held.pid, 'SIGTERM');
  } catch {
    // exited in the meantime
  }
  for (let i = 0; i < 100; i++) {
    if (!lock()) return 'stopped';
    await sleep(100);
  }
  return 'stuck';
}

function start(): number | null {
  if (lock()) return null;
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  const out = openSync(join(dir, 'animator.log'), 'a');
  const child = spawn(process.execPath, [daemonScript], { detached: true, stdio: ['ignore', out, out], env: process.env });
  child.unref();
  return child.pid ?? null;
}

async function fail(msg: string): Promise<never> {
  console.error(msg);
  await notify(msg);
  process.exit(1);
}

const command = process.argv[2] ?? 'status';
switch (command) {
  case 'start': {
    const pid = start();
    const msg = pid ? `Animated icons started (pid ${pid})` : 'Animated icons are already running';
    console.log(msg);
    await notify(msg);
    break;
  }
  case 'stop': {
    const result = await stop();
    if (result === 'stuck') await fail('The animator did not stop within 10s');
    const msg = result === 'stopped' ? 'Animated icons stopped' : 'Animated icons were not running';
    console.log(msg);
    await notify(msg);
    break;
  }
  case 'restart': {
    if ((await stop()) === 'stuck') await fail('The animator did not stop within 10s; not restarted');
    const pid = start();
    if (!pid) await fail('Could not start the animator');
    const msg = `Animated icons restarted (pid ${pid})`;
    console.log(msg);
    await notify(msg);
    break;
  }
  case 'status': {
    const held = lock();
    console.log(held ? `running (pid ${held.pid}, socket ${held.socket})` : 'not running');
    break;
  }
  case 'preview':
    await createClient()('plugin.pane.open', { plugin_id: PLUGIN_ID, entrypoint: 'preview', focus: true });
    break;
  default:
    console.error(`usage: control.js start|stop|restart|status|preview (got ${command})`);
    process.exit(2);
}
