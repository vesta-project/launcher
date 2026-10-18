import { isTauri } from '@tauri-apps/api/core';
import { open as openInShell } from '@tauri-apps/plugin-shell';
import { createSignal, untrack } from 'solid-js';
import { setting, updateSetting } from '../settings/config';

/**
 * Every link that leaves the launcher goes through `openExternal`. Like the old launcher, it
 * asks first ("Open link" / "Stay in app") unless the site is trusted: the Microsoft sign-in
 * pages the account flow opens, or a site the user chose to always open (a plain list in the
 * settings, never anything sensitive). Links that route to an in-app page never come here.
 */

const allowed = /^(https?:\/\/|mailto:)/i;

/** Sign-in pages opened by the account flow; the old launcher never warned for these either. */
const signInHosts = ['login.live.com', 'login.microsoftonline.com'];
const signInPrefixes = ['https://www.microsoft.com/link', 'https://microsoft.com/link'];

/** The site a URL belongs to, as the user would name it: its host without `www.`. */
export function siteOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return undefined;
    return parsed.hostname.toLowerCase().replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

const onSite = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

/** The trusted list, tolerating a hand-edited or stale mirror. */
export function trustedSites(): string[] {
  const list = setting('trusted_link_domains');
  return Array.isArray(list) ? list.filter((site): site is string => typeof site === 'string') : [];
}

export function isTrustedLink(url: string): boolean {
  const lower = url.toLowerCase();
  if (signInPrefixes.some((prefix) => lower.startsWith(prefix))) return true;
  const site = siteOf(url);
  if (!site) return false;
  if (signInHosts.some((host) => onSite(site, host))) return true;
  return untrack(trustedSites).some((trusted) => onSite(site, trusted));
}

export interface PendingLink {
  url: string;
  /** The site the "always open" choice would trust; absent for mailto and odd URLs. */
  site: string | undefined;
}

const [pendingLink, setPendingLink] = createSignal<PendingLink | undefined>(undefined, { name: 'pendingExternalLink' });
export { pendingLink };
let settle: ((opened: boolean) => void) | undefined;

/** Opens the URL in the system browser now, without asking. */
async function openNow(url: string) {
  if (isTauri()) await openInShell(url);
  else window.open(url, '_blank', 'noopener');
}

/**
 * Opens a URL outside the launcher after the user confirms (or straight away when trusted).
 * Resolves true when the link was opened. A second request replaces a pending one.
 */
export function openExternal(url: string): Promise<boolean> {
  const href = url.trim();
  if (!allowed.test(href)) return Promise.resolve(false);
  if (isTrustedLink(href)) return openNow(href).then(() => true);
  settle?.(false);
  return new Promise((resolve) => {
    settle = resolve;
    setPendingLink({ url: href, site: siteOf(href) });
  });
}

/** The dialog's answer. `remember` trusts the link's site from now on. */
export function answerPendingLink(open: boolean, remember = false) {
  const current = untrack(pendingLink);
  const done = settle;
  settle = undefined;
  setPendingLink(undefined);
  if (!current) return;
  if (!open) {
    done?.(false);
    return;
  }
  if (remember && current.site) trustSite(current.site);
  openNow(current.url).then(
    () => done?.(true),
    () => done?.(false),
  );
}

export function trustSite(site: string) {
  const list = untrack(trustedSites);
  if (!list.includes(site)) updateSetting('trusted_link_domains', [...list, site].sort());
}

export function forgetTrustedSites() {
  updateSetting('trusted_link_domains', []);
}
