import type { Activity } from '../../features/activity';

/** Legacy or partial native rows may lack their title at the UI boundary. */
export function initialsOf(activity: Pick<Activity, 'title' | 'iconFallback'>): string {
  const short = activity.iconFallback?.trim();
  if (short && short.length <= 2) return short.toUpperCase();
  const words = (activity.title ?? '').match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function hueOf(title: string | null | undefined): number {
  const text = title ?? '';
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}
