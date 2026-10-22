import { describe, expect, it } from 'vitest';
import { Animator, phaseOf, REFRESH_MS, tokenFor, type Observed } from '../src/animator.js';
import { parseConfig } from '../src/config.js';
import { toBraille } from '../src/pixels.js';
import { applyBlock, conflicts, removeBlock, sidebarBlock } from '../src/sidebar.js';
import { frameAt, ICON_SETS, STATES, type Animation } from '../src/sprites.js';

describe('toBraille', () => {
  it('maps pixels to braille dots, two columns per cell', () => {
    expect(toBraille(['....', '....', '....', '....'])).toBe('⠀⠀');
    expect(toBraille(['##..', '##..', '##..', '##..'])).toBe('⣿⠀');
    expect(toBraille(['#...', '....', '....', '...#'])).toBe('⠁⢀');
    expect(toBraille(['#..', '...', '...', '...'])).toBe('⠁⠀'); // odd width rounds up
  });

  it('rejects grids that are not 4 rows tall', () => {
    expect(() => toBraille(['#'])).toThrow(/4 rows/);
  });
});

describe('icon sets', () => {
  it('define every state with same-width, non-empty frames', () => {
    for (const [name, set] of Object.entries(ICON_SETS)) {
      for (const state of STATES) {
        const { frames, fps } = set[state];
        expect(frames.length, `${name}.${state}`).toBeGreaterThan(0);
        expect(fps).toBeGreaterThanOrEqual(0);
        expect(new Set(frames.map((f) => [...f].length)).size, `${name}.${state} widths`).toBe(1);
        expect([...frames[0]!].length, `${name}.${state} fits the sidebar`).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('frameAt', () => {
  const a: Animation = { fps: 2, frames: ['a', 'b', 'c'] };
  it('advances with time, speed and phase, and wraps', () => {
    expect(frameAt(a, 0)).toBe('a');
    expect(frameAt(a, 500)).toBe('b');
    expect(frameAt(a, 1500)).toBe('a');
    expect(frameAt(a, 250, 2)).toBe('b');
    expect(frameAt(a, 0, 1, 1000)).toBe('c');
  });
  it('is static for fps 0 or speed 0', () => {
    expect(frameAt({ fps: 0, frames: ['x', 'y'] }, 9999)).toBe('x');
    expect(frameAt(a, 9999, 0)).toBe('a');
  });
});

describe('Animator', () => {
  const set = ICON_SETS.classic;
  const pane = (id: string, status: string): Observed => ({ target: { kind: 'pane', id }, status });
  const make = (budget = 100) => new Animator({ set, speed: 1, budget }, 1000);

  it('first report sets the state token and clears the other states', () => {
    const [r] = make().tick([pane('w1:p1', 'working')], 0);
    expect(r!.target).toEqual({ kind: 'pane', id: 'w1:p1' });
    expect(Object.keys(r!.tokens).sort()).toEqual(STATES.map(tokenFor).sort());
    expect(r!.tokens[tokenFor('working')]).toBe(frameAt(set.working, 0, 1, phaseOf('w1:p1')));
    expect(r!.tokens[tokenFor('idle')]).toBeNull();
    expect(r!.source).toBe('plugin:dima.icons');
  });

  it('sends only changed frames, re-sends static ones before the TTL, and uses increasing seqs', () => {
    const an = make();
    const first = an.tick([pane('p', 'unknown')], 0);
    expect(an.tick([pane('p', 'unknown')], 1000)).toEqual([]);
    const refresh = an.tick([pane('p', 'unknown')], REFRESH_MS);
    expect(refresh).toHaveLength(1);
    expect(refresh[0]!.tokens).toEqual({ [tokenFor('unknown')]: set.unknown.frames[0] });
    expect(refresh[0]!.seq).toBeGreaterThan(first[0]!.seq);
  });

  it('on a state change clears the old token and sets the new one', () => {
    const an = make();
    an.tick([pane('p', 'working')], 0);
    const [r] = an.tick([pane('p', 'blocked')], 10);
    expect(r!.tokens[tokenFor('working')]).toBeNull();
    expect(typeof r!.tokens[tokenFor('blocked')]).toBe('string');
    expect(Object.keys(r!.tokens)).toHaveLength(2);
  });

  it('clears targets that went away, and everything on clearAll', () => {
    const an = make();
    an.tick([pane('a', 'idle'), pane('b', 'idle')], 0);
    const [r] = an.tick([pane('a', 'idle')], 10);
    expect(r!.target.id).toBe('b');
    expect(Object.values(r!.tokens).every((v) => v === null)).toBe(true);
    const cleared = an.clearAll();
    expect(cleared.map((c) => c.target.id)).toEqual(['a']);
    expect(an.tick([], 20)).toEqual([]);
  });

  it('treats unknown statuses as unknown and supports workspaces', () => {
    const [r] = make().tick([{ target: { kind: 'workspace', id: 'w1' }, status: 'weird' }], 0);
    expect(r!.tokens[tokenFor('unknown')]).toBe(set.unknown.frames[0]);
  });

  it('keeps state changes when the budget drops them, and sends them first', () => {
    const an = make(1);
    an.tick([pane('a', 'working')], 0);
    an.tick([pane('b', 'working')], 0);
    // Budget 1: the state change of "a" wins over b's next frame…
    const [r] = an.tick([pane('a', 'done'), pane('b', 'working')], 2000);
    expect(r!.target.id).toBe('a');
    // …and a dropped state change is rebuilt (with the clear) on the next tick.
    const an2 = make(1);
    an2.tick([pane('a', 'working')], 0);
    an2.tick([pane('b', 'working')], 0);
    an2.tick([pane('b', 'idle'), pane('a', 'idle')], 10);
    const [next] = an2.tick([pane('b', 'idle'), pane('a', 'idle')], 20);
    expect(next!.target.id).toBe('a');
    expect(next!.tokens[tokenFor('working')]).toBeNull();
  });

  it('forget makes the next tick redraw from scratch', () => {
    const an = make();
    an.tick([pane('p', 'working')], 0);
    an.forget({ kind: 'pane', id: 'p' });
    const [r] = an.tick([pane('p', 'working')], 1);
    expect(Object.keys(r!.tokens)).toHaveLength(STATES.length);
  });

  it('reports whether anything animates', () => {
    const an = make();
    an.tick([pane('p', 'unknown')], 0);
    expect(an.animating).toBe(false);
    an.tick([pane('p', 'working')], 1);
    expect(an.animating).toBe(true);
  });
});

describe('parseConfig', () => {
  it('accepts valid fields and warns about bad ones', () => {
    expect(parseConfig({ set: 'face', speed: 2, spaces: false }).config).toMatchObject({ set: 'face', speed: 2, spaces: false });
    const bad = parseConfig({ set: 'nope', speed: -1, spaces: 'yes', maxRequestsPerSecond: 0 });
    expect(bad.config).toMatchObject({ set: 'classic', speed: 1, spaces: true, maxRequestsPerSecond: 60 });
    expect(bad.warnings).toHaveLength(4);
    expect(parseConfig([]).warnings).toHaveLength(1);
  });
});

describe('sidebar config', () => {
  it('appends the block, replaces it on re-run, and removes it', () => {
    const user = '[ui]\naccent = "cyan"\n';
    const once = applyBlock(user, true);
    expect(once.ok && once.toml).toBe(`${user}\n${sidebarBlock(true)}\n`);
    const twice = once.ok ? applyBlock(once.toml, false) : null;
    expect(twice?.ok && twice.toml).toBe(`${user}\n${sidebarBlock(false)}\n`);
    expect(twice?.ok && removeBlock(twice.toml)).toBe(user);
    expect(removeBlock(sidebarBlock(true) + '\n')).toBe('');
  });

  it('uses one colored token per state in place of state_icon', () => {
    const block = sidebarBlock(true);
    for (const s of STATES) expect(block).toContain(`{ token = "$icon_${s}", fg = "#`);
    expect(block).not.toContain('state_icon');
  });

  it('refuses to touch sidebar rows the user wrote', () => {
    expect(conflicts('[ui.sidebar.agents]\nrow_gap = 1\n', true)).toEqual(['[ui.sidebar.agents]']);
    expect(conflicts('[ui]\nsidebar.spaces.rows = []\n', true)).toEqual(['[ui.sidebar.spaces]']);
    expect(conflicts('[ui.sidebar]\nagents = { rows = [] }\n', true)).toEqual(['[ui.sidebar.agents]']);
    expect(conflicts('[ui.sidebar.spaces]\nrows = []\n', false)).toEqual([]);
    expect(conflicts(sidebarBlock(true), true)).toEqual([]);
    const r = applyBlock('[ui.sidebar.agents]\nrows = []\n', true);
    expect(r.ok).toBe(false);
  });
});
