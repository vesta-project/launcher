import type { MessageId } from '../../localization/messages';
import type { TranslationArgs } from '../../localization/catalog';

export interface ActivitySubject { id?: string | null; name: string; iconUrl?: string | null; instanceId?: string | null }
export interface ActivityCount { done: number; total?: number | null }
export interface StructuredActivity {
  kind: string;
  subject?: ActivitySubject | null;
  source?: ActivitySubject | null;
  destination?: ActivitySubject | null;
  mode?: 'copy' | 'move' | null;
  stage?: string;
  items?: ActivityCount | null;
  bytes?: ActivityCount | null;
  overall?: number;
  visibility?: 'foreground' | 'background';
  fileName?: string | null;
  title: string;
  subtitle?: string;
  step?: string;
}
type Translate = (id: MessageId, args?: TranslationArgs) => string;
const titles: Record<string, MessageId> = {
  instance_install: 'activity.kind-instance-install',
  modpack_install: 'activity.kind-modpack-install',
  modpack_update: 'activity.kind-modpack-update',
  modpack_export: 'activity.kind-modpack-export',
  resource_install: 'activity.kind-resource-install',
  java_download: 'activity.kind-java-download',
  launcher_import: 'activity.kind-launcher-import',
  import_resync: 'activity.kind-import-resync',
  resource_enrichment: 'activity.kind-resource-enrichment',
  manifest_refresh: 'activity.kind-manifest-refresh',
  profile_sync: 'activity.kind-profile-sync',
  instance_duplicate: 'activity.kind-instance-duplicate',
  instance_reset: 'activity.kind-instance-reset',
  instance_repair: 'activity.kind-instance-repair',
  instance_delete: 'activity.kind-instance-delete',
  world_transfer: 'activity.kind-world-transfer',
  drop_apply: 'activity.kind-drop-apply',
};
const stages: Record<string, MessageId> = {
  preparing: 'activity.stage-preparing',
  installing: 'activity.stage-installing',
  downloading: 'activity.stage-downloading',
  loading_metadata: 'activity.stage-loading-metadata',
  downloading_client: 'activity.stage-downloading-client',
  downloading_assets: 'activity.stage-downloading-assets',
  downloading_libraries: 'activity.stage-downloading-libraries',
  running_processors: 'activity.stage-running-processors',
  installing_java: 'activity.stage-installing-java',
  analyzing: 'activity.stage-analyzing',
  extracting: 'activity.stage-extracting',
  downloading_resources: 'activity.stage-downloading-resources',
  finalizing: 'activity.stage-finalizing',
  verifying: 'activity.stage-verifying',
  locating_files: 'activity.stage-locating-files',
  copying_files: 'activity.stage-copying-files',
  saving_records: 'activity.stage-saving-records',
  removing_files: 'activity.stage-removing-files',
  stopping_watcher: 'activity.stage-stopping-watcher',
  removing_records: 'activity.stage-removing-records',
  waiting_for_exit: 'activity.stage-waiting-for-exit',
  reconciling: 'activity.stage-reconciling',
  matching_resources: 'activity.stage-matching-resources',
  syncing_profiles: 'activity.stage-syncing-profiles',
  exporting: 'activity.stage-exporting',
  applying: 'activity.stage-applying',
};
const finiteCount = (n: number) => Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
/** A display label may contain punctuation, but never expose a host path. */
const label = (value?: string | null) => value && !/[\\/]/.test(value) ? value : undefined;

export function formatActivityBytes(value: number, locale: string): string {
  const n = finiteCount(value);
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
  const power = Math.min(4, n > 0 ? Math.floor(Math.log(n) / Math.log(1000)) : 0);
  return new Intl.NumberFormat(locale, { style: 'unit', unit: units[power], unitDisplay: 'short', maximumFractionDigits: 1 }).format(n / 1000 ** power);
}

/** Pure formatter: the caller supplies its active Fluent translator and locale. */
export function formatActivityText(activity: StructuredActivity, t: Translate, locale: string) {
  const titleId = Object.hasOwn(titles, activity.kind) ? titles[activity.kind] : undefined;
  if (!titleId) return { title: activity.title, subtitle: activity.subtitle, step: activity.step };
  const fallback = activity.kind === 'world_transfer' ? 'activity.subject-world'
    : activity.kind === 'resource_install' ? 'activity.subject-resource'
    : activity.kind === 'java_download' ? 'activity.subject-java' : 'activity.subject-instance';
  const name = label(activity.subject?.name) ?? t(fallback);
  const title = t(activity.kind === 'world_transfer' && activity.mode === 'move' ? 'activity.kind-world-move' : titleId, { name });
  const source = label(activity.source?.name);
  const subtitle = source ? activity.kind === 'instance_duplicate'
    ? t('activity.duplicate-subtitle', { name: source })
    : t('activity.transfer-subtitle', { source, target: label(activity.destination?.name) ?? name }) : undefined;
  const stageId = activity.stage && Object.hasOwn(stages, activity.stage) ? stages[activity.stage] : undefined;
  const stage = t(stageId ?? 'activity.working');
  let step = stage;
  const counter = activity.bytes ?? activity.items;
  if (counter) {
    const bytes = !!activity.bytes;
    const done = bytes ? formatActivityBytes(counter.done, locale) : new Intl.NumberFormat(locale).format(finiteCount(counter.done));
    const total = counter.total == null ? undefined : bytes ? formatActivityBytes(counter.total, locale) : new Intl.NumberFormat(locale).format(finiteCount(counter.total));
    step = t(bytes ? total === undefined ? 'activity.stage-bytes-done' : 'activity.stage-bytes'
      : total === undefined ? 'activity.stage-items-done' : 'activity.stage-items', { stage, done, ...(total === undefined ? {} : { total }) });
  }
  return { title, subtitle, step };
}
