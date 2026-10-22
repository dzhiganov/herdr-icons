import { blank, plot, toBraille, type Grid } from './pixels.js';

/** herdr's semantic agent states (`agent_status`). */
export const STATES = ['working', 'blocked', 'done', 'idle', 'unknown'] as const;
export type AgentState = (typeof STATES)[number];

export function isAgentState(s: unknown): s is AgentState {
  return typeof s === 'string' && (STATES as readonly string[]).includes(s);
}

export interface Animation {
  /** Frames per second. 0 = static (only the first frame). */
  fps: number;
  /** Encoded frames (braille strings). */
  frames: string[];
}

export type IconSet = Record<AgentState, Animation>;

const anim = (fps: number, grids: Grid[]): Animation => ({ fps, frames: grids.map(toBraille) });
const repeat = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x);

// ── classic: equalizer, blinking alert, check mark, breathing dot ──────────────

/** Six bars whose heights follow phase-shifted sine waves. */
function equalizer(frames: number): Grid[] {
  return Array.from({ length: frames }, (_, f) => {
    const heights = Array.from({ length: 6 }, (_, c) =>
      Math.round(2.5 + 1.5 * Math.sin((2 * Math.PI * f) / frames + c * 1.1)),
    );
    return [0, 1, 2, 3].map((y) => heights.map((h) => (4 - y <= h ? '#' : '.')).join(''));
  });
}

const BANG = ['..##..', '..##..', '......', '..##..'];
const BANG_LOUD = ['#.##.#', '#.##.#', '#....#', '#.##.#'];

// Check mark pixels in drawing order.
const CHECK: [number, number][] = [
  [0, 2],
  [1, 3],
  [2, 3],
  [3, 2],
  [4, 1],
  [5, 0],
];

function checkFrames(): Grid[] {
  const steps: Grid[] = [];
  let g: Grid = blank(6);
  for (const [x, y] of CHECK) {
    g = plot(g, x, y);
    steps.push(g);
  }
  const full = g;
  const sparkle = plot(plot(full, 5, 2), 4, 3);
  return [...steps, ...repeat(30, full), sparkle, full, sparkle, ...repeat(10, full)];
}

const DOT = ['......', '..##..', '..##..', '......'];
const RING = ['..##..', '.#..#.', '.#..#.', '..##..'];

const classic: IconSet = {
  working: anim(8, equalizer(12)),
  blocked: anim(4, [BANG, BANG_LOUD, BANG, blank(6)]),
  done: anim(6, checkFrames()),
  idle: anim(2, [DOT, DOT, DOT, DOT, RING, DOT]),
  unknown: anim(0, [['......', '......', '##..##', '......']]),
};

// ── face: a little robot with two eyes ─────────────────────────────────────────

const OPEN = ['......', '##..##', '##..##', '......'];
const SHUT = ['......', '......', '##..##', '......'];
const LEFT = ['......', '##.##.', '##.##.', '......'];
const RIGHT = ['......', '.##.##', '.##.##', '......'];
const UP = ['##..##', '##..##', '......', '......'];
const DOWN = ['......', '......', '##..##', '##..##'];
const WIDE = ['##..##', '##..##', '##..##', '##..##'];
const SQUINT = ['#....#', '.#..#.', '#....#', '......']; // > <
const HAPPY_UP = ['.#..#.', '#.##.#', '......', '......']; // ^ ^
const HAPPY_MID = ['......', '.#..#.', '#.##.#', '......'];

const face: IconSet = {
  working: anim(5, [OPEN, LEFT, LEFT, OPEN, RIGHT, RIGHT, OPEN, UP, OPEN, DOWN, DOWN, OPEN]),
  blocked: anim(3, [WIDE, SQUINT]),
  done: anim(2, [HAPPY_UP, HAPPY_MID]),
  idle: anim(4, [...repeat(14, OPEN), SHUT, OPEN, OPEN, SHUT]),
  unknown: anim(0, [SHUT]),
};

export const ICON_SETS = { classic, face } as const satisfies Record<string, IconSet>;
export type IconSetName = keyof typeof ICON_SETS;

export function isIconSetName(s: unknown): s is IconSetName {
  return typeof s === 'string' && Object.hasOwn(ICON_SETS, s);
}

/**
 * Frame of `animation` at `timeMs`, sped up by `speed`. `phaseMs` shifts the
 * clock so several agents in the same state don't move in lockstep.
 */
export function frameAt(animation: Animation, timeMs: number, speed = 1, phaseMs = 0): string {
  const { fps, frames } = animation;
  if (fps <= 0 || speed <= 0 || frames.length <= 1) return frames[0] ?? '';
  const index = Math.floor(((timeMs + phaseMs) / 1000) * fps * speed);
  return frames[((index % frames.length) + frames.length) % frames.length]!;
}
