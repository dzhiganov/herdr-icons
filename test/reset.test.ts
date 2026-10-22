import { expect, it } from 'vitest';
import { Animator } from '../src/animator.js';
import { ICON_SETS, STATES } from '../src/sprites.js';

it('reset redraws every target with a full report', () => {
  const an = new Animator({ set: ICON_SETS.classic, speed: 1, budget: 10 }, 0);
  const obs = [{ target: { kind: 'pane' as const, id: 'p' }, status: 'idle' }];
  an.tick(obs, 0);
  expect(an.tick(obs, 10)).toEqual([]);
  an.reset();
  const [r] = an.tick(obs, 20);
  expect(Object.keys(r!.tokens)).toHaveLength(STATES.length);
});
