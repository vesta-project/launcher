import { expect, test } from 'bun:test';
import { sameReviewedPlan } from '../src/features/servers/review-plan';

test('credential refresh preserves consent only when reviewed effects match', () => {
  const plan = { planId: 'old', confirmationToken: 'old', expiresAtMs: 1, files: [{ path: 'mods/a.jar', sha256: 'a' }], warnings: [] };
  expect(sameReviewedPlan(plan, { ...plan, planId: 'fresh', confirmationToken: 'fresh', expiresAtMs: 999 })).toBe(true);
  expect(sameReviewedPlan(plan, { ...plan, files: [{ path: 'mods/a.jar', sha256: 'b' }] })).toBe(false);
  expect(sameReviewedPlan(plan, { ...plan, warnings: ['changed'] })).toBe(false);
});

import { reviewEmpty, reviewApplyRequest } from '../src/features/servers/pack-install-review';
import { seedPackInstallPlan } from '../src/features/servers/fixtures-pack';
test('a deferred manifest plan stays installable before file analysis', () => {
 const plan = {...seedPackInstallPlan('provider'), deferred:true, softwareSwitchRequired:false, softwareSwitch:null, files:[], removed:[], skipped:[], warnings:[]};
 expect(reviewEmpty(plan)).toBe(false);
 expect(reviewApplyRequest(plan,{},false)?.choices).toEqual([]);
 expect(reviewEmpty({...plan,deferred:false})).toBe(true);
});
