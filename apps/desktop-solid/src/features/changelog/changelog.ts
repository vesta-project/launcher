import { invoke, isTauri } from '@tauri-apps/api/core';
import { RequestCache } from '../../platform/cache/request-cache';

export interface Release {
  tag: string;
  name: string;
  body: string;
  publishedAt: string;
  url: string;
  prerelease: boolean;
}

interface HostRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
}

const preview: Release[] = [
  {
    tag: 'v0.2.0', name: 'Vesta 0.2', publishedAt: '2026-10-20T00:00:00Z', url: 'https://github.com/Vesta-Project/launcher/releases',
    prerelease: false, body: '## Highlights\n\n- A rebuilt interface\n- Browse with project pages\n- The status pill for everything that is running\n\n## Fixes\n\n- Many small things.',
  },
  {
    tag: 'v0.1.0-alpha.31', name: 'Alpha 31', publishedAt: '2026-09-01T00:00:00Z', url: 'https://github.com/Vesta-Project/launcher/releases',
    prerelease: true, body: '- Earlier release notes.',
  },
];

const cache = new RequestCache<Release[]>({ maxEntries: 1, staleTimeMs: 30 * 60_000, retentionMs: 6 * 60 * 60_000 });

/** GitHub releases through the host (no token, no CORS), newest first, cached for the session. */
export function loadReleases(): Promise<Release[]> {
  return cache.read('releases', async () => {
    if (!isTauri()) return preview;
    const rows = await invoke<HostRelease[]>('get_changelog');
    return rows.map((row) => ({
      tag: row.tag_name,
      name: row.name || row.tag_name,
      body: row.body ?? '',
      publishedAt: row.published_at,
      url: row.html_url,
      prerelease: /-(alpha|beta|rc)\b/i.test(row.tag_name),
    }));
  });
}

export const peekReleases = () => cache.peek('releases')?.data;

/** "v0.2.0" and "0.2.0" name the same release. */
export const sameVersion = (tag: string, version: string) => tag.replace(/^v/i, '') === version.replace(/^v/i, '');
