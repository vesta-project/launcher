/** First edit captures a base. Only explicit review permits rebasing a draft. */
export class EditRevision {
  private started = false;
  private base: unknown;
  begin(revision: unknown) { if (!this.started) { this.started = true; this.base = revision; } }
  conflicts(revision: unknown) { return this.started && this.base !== revision; }
  review(revision: unknown) { this.base = revision; }
  reset() { this.started = false; this.base = undefined; }
}

/** Three-way refresh: only locally changed values remain over the newest copy. */
export function refreshUnedited<T>(base: T, draft: T, current: T): T {
  if (JSON.stringify(base) === JSON.stringify(draft)) return current;
  if (base && draft && current && typeof base === 'object' && typeof draft === 'object' && typeof current === 'object' && !Array.isArray(base) && !Array.isArray(draft) && !Array.isArray(current)) {
    const result = { ...current } as Record<string, unknown>;
    const before = base as Record<string, unknown>, local = draft as Record<string, unknown>, latest = current as Record<string, unknown>;
    for (const key of Object.keys(draft)) result[key] = refreshUnedited(before[key], local[key], latest[key]);
    return result as T;
  }
  return draft;
}
