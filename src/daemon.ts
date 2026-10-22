import { statSync } from 'node:fs';
import { join } from 'node:path';
import { Animator, type Observed } from './animator.js';
import { loadConfig, configDir, stateDir, type Config } from './config.js';
import { ApiError, ConnectionError, listAgents, listWorkspaces, reportTokens, type Request } from './herdr.js';
import { acquireLock, releaseLock } from './lock.js';
import { ICON_SETS } from './sprites.js';

const POLL_MS = 1_000;
const FAST_TICK_MS = 50;
const IDLE_TICK_MS = 500;
const CONFIG_CHECK_MS = 3_000;
/** Give up when the socket has been unreachable this long (herdr stopped). */
const GIVE_UP_MS = 30_000;
const CONCURRENCY = 8;

const log = (msg: string) => process.stderr.write(`[herdr-icons] ${msg}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Wall-clock-like but monotonic: frame timing and refreshes survive clock jumps. */
const clock = () => performance.timeOrigin + performance.now();

/** Logs each distinct message once, so a persistent error doesn't flood the log. */
function logOnce(): (msg: string) => void {
  const seen = new Set<string>();
  return (msg) => {
    if (seen.has(msg) || seen.size > 200) return;
    seen.add(msg);
    log(msg);
  };
}

// ── main loop ──────────────────────────────────────────────────────────────────

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

function animatorOptions(config: Config, tickMs: number) {
  return {
    set: ICON_SETS[config.set],
    speed: config.speed,
    budget: Math.ceil((config.maxRequestsPerSecond * tickMs) / 1000),
  };
}

export async function runDaemon(request: Request, socket: string): Promise<void> {
  const lockDir = stateDir();
  const running = acquireLock(socket, lockDir);
  if (running) {
    log(`already running (pid ${running.pid}); exiting`);
    return;
  }
  const warn = logOnce();

  const configFile = join(configDir(), 'config.json');
  let { config, warnings } = loadConfig();
  for (const w of warnings) log(`config: ${w}`);
  const mtime = () => {
    try {
      return statSync(configFile).mtimeMs;
    } catch {
      return 0;
    }
  };
  let configMtime = mtime();
  let configCheckedAt = clock();

  const animator = new Animator(animatorOptions(config, FAST_TICK_MS));
  let observed: Observed[] = [];
  let polledAt = 0;
  let lastContact = clock();
  let unreachable = false;
  let stopping = false;

  const stop = () => {
    stopping = true;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('SIGHUP', stop);

  const send = (reports: ReturnType<Animator['tick']>) =>
    pool(reports, CONCURRENCY, async (r) => {
      try {
        await reportTokens(request, r);
        lastContact = clock();
      } catch (err) {
        if (err instanceof ApiError) {
          lastContact = clock();
          // not_found: the pane or space closed between poll and send. Expected.
          if (err.code !== 'not_found') warn(`report failed: ${err.message}`);
        } else {
          unreachable = true; // herdr may be restarting: redraw everything once it's back
        }
        animator.forget(r.target);
      }
    });

  log(`started (pid ${process.pid}, set ${config.set}, socket ${socket})`);
  try {
    while (!stopping) {
      const now = clock();

      if (now - configCheckedAt >= CONFIG_CHECK_MS) {
        configCheckedAt = now;
        const m = mtime();
        if (m !== configMtime) {
          configMtime = m;
          ({ config, warnings } = loadConfig());
          for (const w of warnings) log(`config: ${w}`);
          animator.setOptions(animatorOptions(config, FAST_TICK_MS));
          log(`config reloaded (set ${config.set}, speed ${config.speed})`);
        }
      }

      if (now - polledAt >= POLL_MS) {
        polledAt = now;
        try {
          const [agents, workspaces] = await Promise.all([
            listAgents(request),
            config.spaces ? listWorkspaces(request) : Promise.resolve([]),
          ]);
          observed = [
            ...agents.map((a) => ({ target: { kind: 'pane' as const, id: a.pane_id }, status: a.agent_status })),
            ...workspaces.map((w) => ({ target: { kind: 'workspace' as const, id: w.workspace_id }, status: w.agent_status })),
          ];
          if (unreachable) animator.reset(); // a restarted herdr starts without our tokens
          unreachable = false;
          lastContact = clock();
        } catch (err) {
          if (err instanceof ConnectionError) unreachable = true;
          else {
            if (err instanceof ApiError) lastContact = clock(); // herdr answered: it's there
            warn(`poll failed: ${(err as Error).message}`);
          }
          if (clock() - lastContact > GIVE_UP_MS) {
            log('herdr is unreachable; exiting');
            return;
          }
        }
      }

      await send(animator.tick(observed, clock()));
      const tickMs = animator.animating ? FAST_TICK_MS : IDLE_TICK_MS;
      await sleep(Math.max(0, tickMs - (clock() - now)));
    }
  } finally {
    await Promise.race([send(animator.clearAll()), sleep(1_500)]);
    releaseLock(socket, lockDir);
    log('stopped');
  }
}
