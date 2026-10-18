import { untrack } from 'solid-js';
import { t } from '../../localization';
import { clearFinishedActivities, receiveActivity, activities } from './activity-store';
import { setUpdaterFixture } from '../settings/updates';
export type ActivityFixture = 'single' | 'multiple' | 'background' | 'success' | 'failure' | 'update-ready';
/**
 * Dev-only simulator, on `window.vestaDev.simulateActivity('multiple')` in dev builds (the
 * WebKit console cannot run top-level `import`). Only fixture rows are touched, so real
 * tasks keep running. Returns timer cleanup.
 */
function startSimulation(scenario: ActivityFixture): () => void {
  if (!import.meta.env.DEV) return () => {};
  for (const row of untrack(activities)) if (row.id.startsWith('fixture-')) receiveActivity({ id: row.id, state: 'cancelled' });
  clearFinishedActivities(untrack(activities).filter((row) => row.id.startsWith('fixture-')).map((row) => row.id));
  setUpdaterFixture({ state: 'idle' });
  if (scenario === 'update-ready') { setUpdaterFixture({ state: 'ready', version: '0.3.0' }); return () => {}; }
  const now = Date.now();
  const title = t('activity.fixture-install');
  if (scenario === 'background') {
    receiveActivity({ id: 'fixture-background', title: t('activity.fixture-background'), kind: 'background', state: 'running' });
    const timer = setTimeout(() => receiveActivity({ id: 'fixture-background', state: 'done' }), 5000);
    return () => clearTimeout(timer);
  }
  const count = scenario === 'multiple' ? 5 : 1;
  for (let i = 0; i < count; i++) receiveActivity({ id: `fixture-install-${i}`, kind: 'task', title: `${title} ${i + 1}`, subtitle: 'Minecraft 1.21.1 · Fabric',
    iconFallback: 'minecraft', state: scenario === 'success' ? 'done' : scenario === 'failure' ? 'failed' : 'running',
    progress: scenario === 'multiple' ? i / 6 : 0.42, weight: (i + 1) * 100, step: t('activity.fixture-step', { count: 47, max: 112 }),
    cancellable: true, startedAt: now, target: { instanceId: `fixture-${i}` }, action: 'play',
    error: scenario === 'failure' ? t('activity.fixture-error') : undefined });
  if (scenario === 'success' || scenario === 'failure') return () => {};
  const timer = setInterval(() => {
    for (const row of untrack(activities)) {
      if (row.state !== 'running' || !row.id.startsWith('fixture-install-')) continue;
      const progress = Math.min(1, (row.progress ?? 0) + 0.025);
      receiveActivity({ id: row.id, progress, weight: Math.max(1, 1000 * (1 - progress)), state: progress === 1 ? 'done' : 'running' });
    }
  }, 300);
  return () => clearInterval(timer);
}

let stopPrevious: () => void = () => {};
export function simulateActivity(scenario: ActivityFixture): () => void {
  stopPrevious();
  stopPrevious = startSimulation(scenario);
  return stopPrevious;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { vestaDev?: Record<string, unknown> }).vestaDev = {
    ...(window as unknown as { vestaDev?: Record<string, unknown> }).vestaDev,
    simulateActivity,
  };
}
