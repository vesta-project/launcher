/** Native progress is 0–100; normalization belongs to the desktop Adapter. */
export interface NativeActivity {
  id: string;
  attempt?: string;
  kind: 'task' | 'background';
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  title: string;
  progress?: number | null;
  overallProgress?: number | null;
  currentStep?: number | null;
  totalSteps?: number | null;
  step?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  cancellable: boolean;
  action?: 'play' | 'open';
  target?: { instanceId?: string; route?: string };
  context?: { kind?: string; id?: string; label?: string; iconUrl?: string };
}
export interface ActivityRecord { revision: number; activity: NativeActivity }
export interface ActivitySnapshot { epoch: string; revision: number; activities: ActivityRecord[] }
export interface ActivityEvent extends ActivityRecord { epoch: string }

/** Snapshot watermark plus per-row revisions: independent tasks may arrive out of order.
 * A focus snapshot compacts revision tracking; no progress polling or persisted mirror.
 */
export class ActivityRecovery {
  epoch: string | undefined;
  private floor = 0;
  private revisions = new Map<string, number>();
  constructor(
    private readonly ids: Set<string>,
    private readonly apply: (activity: NativeActivity) => void,
    private readonly retire: (ids: readonly string[]) => void,
  ) {}
  get needsCompaction() { return this.revisions.size > 256; }
  receive(event: ActivityEvent): boolean {
    if (this.epoch !== undefined && event.epoch !== this.epoch) return false;
    this.epoch ??= event.epoch;
    this.accept(event);
    return true;
  }
  private accept(record: ActivityRecord) {
    if (record.revision <= this.floor || record.revision <= (this.revisions.get(record.activity.id) ?? 0)) return;
    this.revisions.set(record.activity.id, record.revision);
    this.ids.add(record.activity.id);
    this.apply(record.activity);
  }
  snapshot(snapshot: ActivitySnapshot) {
    if (snapshot.epoch !== this.epoch) {
      this.retire([...this.ids]);
      this.ids.clear();
      this.revisions.clear();
      this.floor = 0;
      this.epoch = snapshot.epoch;
    }
    if (snapshot.revision < this.floor) return;
    const present = new Set(snapshot.activities.map((row) => row.activity.id));
    const missing = [...this.ids].filter((id) => !present.has(id) && (this.revisions.get(id) ?? 0) <= snapshot.revision);
    this.retire(missing);
    missing.forEach((id) => this.ids.delete(id));
    snapshot.activities.forEach((record) => this.accept(record));
    this.floor = snapshot.revision;
    for (const [id, revision] of this.revisions) if (revision <= this.floor) this.revisions.delete(id);
  }
}
