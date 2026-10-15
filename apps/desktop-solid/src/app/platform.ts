import { isTauri } from '@tauri-apps/api/core';

export type Platform = 'macos' | 'windows' | 'linux' | 'web';

declare global {
  interface Window {
    /** Injected by the Rust host before the page loads. */
    __VESTA_OS__?: string;
  }
}

/** The host OS. The Rust side injects it; a plain browser (workbench) reports `web`. */
export function detectPlatform(): Platform {
  if (typeof window === 'undefined' || !isTauri()) return 'web';
  const os = (window.__VESTA_OS__ ?? navigator.platform).toLowerCase();
  if (os.includes('mac') || os.includes('darwin')) return 'macos';
  if (os.includes('win')) return 'windows';
  return 'linux';
}
