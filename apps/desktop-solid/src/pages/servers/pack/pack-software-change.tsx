import { Show, createEffect, createSignal, onCleanup, untrack } from 'solid-js';
import { ChangeFlow } from '../hosting/software-section';
import { useJavaActions } from '../hosting/java-panel';
import { jobActive, jobPollDelay, jobStepMessage, reasonMessage } from '../../../features/servers/hosting-model';
import type { SoftwareId, SoftwareJob, SoftwareState } from '../../../features/servers/hosting-native';
import { isJavaJob } from '../../../features/servers/server-java-model';
import { ServerErrorNote } from '../parts';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { softwareJobsResource, javaInventoryResource, softwareResource } from '../../../features/servers/server-resources';
import { seedServerResource, useServerResource } from '../../../features/servers/resources';
import { Progress } from '@vesta/ui';
import { t } from '../../../localization';

/** Reuses the normal software review, consent and Java checks inside the pack flow. */
export function PackSoftwareChange(props: {
  id: string; snapshot: ServerSnapshot; state: SoftwareState;
  target: { software: SoftwareId; version: string; loaderVersion: string | null };
  onWorking: (working: boolean) => void; onComplete: () => void;
}) {
  const jobs = useServerResource(() => props.id, softwareJobsResource);
  const java = useServerResource(() => props.id, javaInventoryResource);
  const software = useServerResource(() => props.id, softwareResource);
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'pack-software:error' });
  const [followed, setFollowed] = createSignal<string | null>(null, { name: 'pack-software:job' });
  const current = () => jobs.value()?.find(job => job.id === followed());
  const active = () => jobs.value()?.some(jobActive) ?? false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let completed: string | undefined;
  const follow = (attempt = 0) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { await jobs.refresh(); if (!disposed) setError(null); } catch (reason) { if (!disposed) setError(reason as ServerCommandError); } finally { if (!disposed && (untrack(active) || (!!untrack(followed) && !untrack(current)))) follow(attempt + 1); }
    }, jobPollDelay(attempt));
  };
  const accepted = (job: SoftwareJob) => {
    if (disposed) return;
    seedServerResource(props.id, softwareJobsResource, [job, ...(jobs.value() ?? []).filter(old => old.id !== job.id)]);
    setFollowed(job.id); props.onWorking(true); follow();
  };
  const javaActions = useJavaActions(() => props.snapshot, accepted);
  createEffect(current, job => {
    if (!job || jobActive(job) || completed === job.id) return;
    completed = job.id; clearTimeout(timer);
    if (job.state !== 'succeeded' || isJavaJob(job)) props.onWorking(false);
    if (job.state === 'succeeded') void Promise.all([software.refresh(), java.refresh()]).then(() => { if (!disposed && !isJavaJob(job)) props.onComplete(); }).catch(reason => { if (!disposed) { completed = undefined; props.onWorking(false); setError(reason as ServerCommandError); } });
  }, { name: 'pack-software:completion' });
  createEffect(active, value => { if (value) follow(); }, { name: 'pack-software:follow-active' });
  onCleanup(() => { disposed = true; clearTimeout(timer); });
  return <section data-vesta="server-software-flow">
    <ServerErrorNote error={error()} onRetry={() => follow()} />
    <Show when={current()}>{job => <>
      <Show when={jobActive(job())} fallback={<p role="status">{t(jobStepMessage[job().state])} {reasonMessage(job().error) ? t(reasonMessage(job().error)!) : ''}</p>}>
        <Progress size="sm" label={t(jobStepMessage[job().state])} />
      </Show>
    </>}</Show>
    <Show when={!active()}><ChangeFlow snapshot={props.snapshot} state={props.state} target={props.target}
      jobRunning={active()} onAccepted={accepted} java={java.value()} javaActions={javaActions} /></Show>
  </section>;
}
