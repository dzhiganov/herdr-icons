import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLock, isAnimator, lockPath, readLock, releaseLock } from '../src/lock.js';
import { applyBlock, conflicts, sidebarBlock } from '../src/sidebar.js';

describe('conflicts: every way to spell a sidebar layout', () => {
  const cases: [string, string][] = [
    ['dotted key in [ui]', '[ui]\nsidebar.agents = { rows = [] }\n'],
    ['root dotted key', 'ui.sidebar.agents = { rows = [] }\n'],
    ['nested inline table', '[ui]\nsidebar = { agents = { rows = [] } }\n'],
    ['[ui.sidebar] + dotted subkey', '[ui.sidebar]\nagents.row_gap = 1\n'],
    ['[ui.sidebar] with a [ in an earlier value', '[ui.sidebar]\nx = [1]\nagents = { row_gap = 1 }\n'],
    ['spaced header', '[ ui . sidebar . agents ]\nrow_gap = 1\n'],
    ['quoted header', '["ui"."sidebar"."agents"]\nrow_gap = 1\n'],
    ['plain header', '[ui.sidebar.agents]\nrow_gap = 1\n'],
    ['rows_by_agent', '[ui.sidebar.agents.rows_by_agent]\nclaude = []\n'],
  ];
  it.each(cases)('%s', (_, toml) => {
    expect(conflicts(toml, false)).toEqual(['[ui.sidebar.agents]']);
    expect(applyBlock(toml, false).ok).toBe(false);
  });

  it('ignores comments, string values and look-alike keys', () => {
    const toml = [
      '# [ui.sidebar.agents] is commented out',
      '[ui]',
      'sidebar_width = 30',
      'agent_panel_sort = "spaces"',
      'window_title = "sidebar agents"',
      '[[keys.command]]',
      'description = "ui.sidebar.agents"',
      '',
    ].join('\n');
    expect(conflicts(toml, true)).toEqual([]);
    expect(applyBlock(toml, true).ok).toBe(true);
  });

  it('only checks the spaces panel when spaces are enabled', () => {
    const toml = '[ui.sidebar.spaces]\nrow_gap = 1\n';
    expect(conflicts(toml, false)).toEqual([]);
    expect(conflicts(toml, true)).toEqual(['[ui.sidebar.spaces]']);
  });

  it('never conflicts with its own block', () => {
    expect(conflicts(`[ui]\naccent = "cyan"\n\n${sidebarBlock(true)}\n`, true)).toEqual([]);
  });
});

describe('lock', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'icons-lock-'));

  it('recognises an animator only by its command line', () => {
    expect(isAnimator(123, () => 'node dist/cli/daemon.js')).toBe(true);
    expect(isAnimator(123, () => '/usr/bin/vim notes.txt')).toBe(false); // reused pid
    expect(isAnimator(123, () => null)).toBe(false); // gone
    expect(isAnimator(-1, () => 'daemon.js')).toBe(false);
  });

  it('replaces a stale lock whose pid is not an animator, and releases only its own', () => {
    const d = dir();
    const sock = '/tmp/a.sock';
    // A live pid that isn't an animator (this test runner), e.g. reused after a reboot.
    writeFileSync(lockPath(sock, d), JSON.stringify({ pid: process.ppid, socket: sock }));
    expect(readLock(sock, d)).toBeNull();
    expect(acquireLock(sock, d)).toBeNull();
    expect(JSON.parse(readFileSync(lockPath(sock, d), 'utf8')).pid).toBe(process.pid);
    releaseLock(sock, d);
    expect(() => readFileSync(lockPath(sock, d))).toThrow();
  });

  it('uses one lock file per socket', () => {
    const d = dir();
    expect(lockPath('/a.sock', d)).not.toBe(lockPath('/b.sock', d));
    expect(acquireLock('/a.sock', d)).toBeNull();
    expect(acquireLock('/b.sock', d)).toBeNull();
  });
});

describe('shownStatus', () => {
  it('shows a focused done agent as idle, like the sidebar', async () => {
    const { shownStatus } = await import('../src/herdr.js');
    expect(shownStatus({ agent_status: 'done', focused: true })).toBe('idle');
    expect(shownStatus({ agent_status: 'done', focused: false })).toBe('done');
    expect(shownStatus({ agent_status: 'working', focused: true })).toBe('working');
  });
});
