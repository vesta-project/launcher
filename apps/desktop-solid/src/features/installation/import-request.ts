import { createSignal } from 'solid-js';

/** Which page of the import dialog to open on, and a URL to prefill. */
export interface ImportRequest { step: 'methods' | 'launchers' | 'file'; url?: string; key: number }

// The plain value is the source of truth (signal writes are batched until flush); the signal notifies.
let current: ImportRequest | null = null;
const [version, setVersion] = createSignal(0, { name: 'importRequest' });
let serial = 0;
const set = (next: ImportRequest | null) => { current = next; setVersion((value) => value + 1); };

/**
 * The import dialog belongs to the whole launcher: it opens over the current page, and only a
 * chosen source moves on (to the install form, or a launcher's instance list).
 */
export const importRequest = () => { version(); return current; };
export function openImport(step: ImportRequest['step'] = 'methods', url?: string) { set({ step, url, key: ++serial }); }
export function closeImport() { set(null); }
