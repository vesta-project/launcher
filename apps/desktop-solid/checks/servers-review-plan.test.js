import { expect, test } from 'bun:test';
import { sameReviewedPlan } from '../src/features/servers/review-plan';

test('credential refresh preserves consent only when reviewed effects match', () => {
  const plan = { planId: 'old', confirmationToken: 'old', expiresAtMs: 1, files: [{ path: 'mods/a.jar', sha256: 'a' }], warnings: [] };
  expect(sameReviewedPlan(plan, { ...plan, planId: 'fresh', confirmationToken: 'fresh', expiresAtMs: 999 })).toBe(true);
  expect(sameReviewedPlan(plan, { ...plan, files: [{ path: 'mods/a.jar', sha256: 'b' }] })).toBe(false);
  expect(sameReviewedPlan(plan, { ...plan, warnings: ['changed'] })).toBe(false);
});
