import type { Target, TokenReport } from './herdr.js';
import { frameAt, isAgentState, STATES, type AgentState, type IconSet } from './sprites.js';

/** One sidebar token per state, so each state gets its own color in the sidebar config. */
export const tokenFor = (state: AgentState): string => `icon_${state}`;

export const SOURCE = 'plugin:dima.icons';
/** Tokens expire this long after the last report, so icons vanish if the animator dies. */
export const TTL_MS = 15_000;
/** Static frames are re-sent this often to stay ahead of the TTL. */
export const REFRESH_MS = 5_000;

export interface Observed {
  target: Target;
  /** herdr `agent_status`; anything unrecognised is drawn as `unknown`. */
  status: string;
}

interface Tracked {
  target: Target;
  state: AgentState;
  frame: string | null;
  sentAt: number;
}

export interface AnimatorOptions {
  set: IconSet;
  speed: number;
  /** Most reports `tick` returns per call; the rest wait for later ticks. */
  budget: number;
}

const keyOf = (t: Target) => `${t.kind}:${t.id}`;

/** Stable 0–999 ms offset per target, so agents in the same state don't move in lockstep. */
export function phaseOf(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 1000;
}

function allCleared(except?: AgentState): Record<string, string | null> {
  return Object.fromEntries(STATES.filter((s) => s !== except).map((s) => [tokenFor(s), null]));
}

/**
 * Decides which token reports to send. Pure apart from its own bookkeeping:
 * `tick` gets the current targets and clock, and returns only what changed.
 */
export class Animator {
  private tracked = new Map<string, Tracked>();
  private seq: number;

  constructor(
    private options: AnimatorOptions,
    // herdr ignores a seq at or below the last accepted one for the same source,
    // so start from the clock: a restarted animator still counts upwards.
    seqStart = Date.now() * 1000,
  ) {
    this.seq = seqStart;
  }

  setOptions(options: AnimatorOptions): void {
    this.options = options;
    for (const t of this.tracked.values()) t.frame = null; // redraw everything
  }

  /** True when some tracked target is in an animated state. */
  get animating(): boolean {
    if (this.options.speed <= 0) return false;
    for (const t of this.tracked.values()) if (this.options.set[t.state].fps > 0) return true;
    return false;
  }

  tick(observed: Observed[], now: number): TokenReport[] {
    // Each candidate says what to record if it is sent; unsent ones are rebuilt next tick.
    type Candidate = { report: TokenReport; apply: () => void };
    const urgent: Candidate[] = [];
    const frames: Candidate[] = [];
    const seen = new Set<string>();

    for (const { target, status } of observed) {
      const key = keyOf(target);
      seen.add(key);
      const state: AgentState = isAgentState(status) ? status : 'unknown';
      const frame = frameAt(this.options.set[state], now, this.options.speed, phaseOf(target.id));
      const prev = this.tracked.get(key);
      const sent = () => this.tracked.set(key, { target, state, frame, sentAt: now });

      if (!prev || prev.state !== state) {
        // New target (clear leftovers from an earlier run) or a state change.
        const tokens = { ...(prev ? { [tokenFor(prev.state)]: null } : allCleared(state)), [tokenFor(state)]: frame };
        urgent.push({ report: this.report(target, tokens), apply: sent });
        continue;
      }
      if (prev.frame === frame && now - prev.sentAt < REFRESH_MS) continue;
      const stale = prev.frame === null || now - prev.sentAt >= REFRESH_MS;
      (stale ? urgent : frames).push({ report: this.report(target, { [tokenFor(state)]: frame }), apply: sent });
    }

    for (const [key, t] of this.tracked) {
      if (!seen.has(key)) urgent.push({ report: this.report(t.target, allCleared()), apply: () => this.tracked.delete(key) });
    }

    const out = [...urgent, ...frames].slice(0, Math.max(1, this.options.budget));
    for (const c of out) c.apply();
    return out.map((c) => c.report);
  }

  /** Reports that clear every icon this animator drew (for shutdown). */
  clearAll(): TokenReport[] {
    const out = [...this.tracked.values()].map((t) => this.report(t.target, allCleared()));
    this.tracked.clear();
    return out;
  }

  /** Redraw everything on the next tick (herdr restarted: its tokens are gone). */
  reset(): void {
    this.tracked.clear();
  }

  /** A report failed: forget the target so the next tick redraws it from scratch. */
  forget(target: Target): void {
    this.tracked.delete(keyOf(target));
  }

  private report(target: Target, tokens: Record<string, string | null>): TokenReport {
    return { target, tokens, source: SOURCE, seq: ++this.seq, ttlMs: TTL_MS };
  }
}
