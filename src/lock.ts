import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/** One animator per herdr socket: a pid file named after the socket path. */
export interface LockInfo {
  pid: number;
  socket: string;
}

export function lockPath(socket: string, dir: string): string {
  const id = createHash('sha1').update(socket).digest('hex').slice(0, 12);
  return join(dir, `animator-${id}.pid`);
}

/** Script name the animator runs as; a live pid without it is someone else's process. */
const MARKER = 'daemon.js';

function commandLine(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
  } catch {
    // no /proc (macOS)
  }
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null; // ps exits non-zero when the pid is gone
  }
}

/** True when `pid` is a running animator (not a reused pid after a crash or reboot). */
export function isAnimator(pid: number, cmdline: (pid: number) => string | null = commandLine): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  return cmdline(pid)?.includes(MARKER) ?? false;
}

/** The running animator for this socket, if any. */
export function readLock(socket: string, dir: string): LockInfo | null {
  try {
    const info = JSON.parse(readFileSync(lockPath(socket, dir), 'utf8')) as LockInfo;
    return isAnimator(info.pid) ? info : null;
  } catch {
    return null;
  }
}

/**
 * Take the lock atomically. Returns the holder when another live animator has it;
 * a stale file (dead or reused pid) is replaced.
 */
export function acquireLock(socket: string, dir: string): LockInfo | null {
  mkdirSync(dir, { recursive: true });
  const path = lockPath(socket, dir);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, socket } satisfies LockInfo));
      closeSync(fd);
      return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const holder = readLock(socket, dir);
      if (holder && holder.pid !== process.pid) return holder;
      rmSync(path, { force: true });
    }
  }
  // Lost a race twice in a row: whoever won holds it now.
  return readLock(socket, dir) ?? { pid: -1, socket };
}

export function releaseLock(socket: string, dir: string): void {
  const path = lockPath(socket, dir);
  try {
    const info = JSON.parse(readFileSync(path, 'utf8')) as LockInfo;
    if (info.pid === process.pid) rmSync(path);
  } catch {
    // already gone
  }
}
