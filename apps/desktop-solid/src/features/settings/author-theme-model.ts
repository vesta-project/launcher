import type { ThemeValues } from './theme-model';

/** Only Rust-validated, canonical styles are returned by the native theme commands. */
export interface AuthorTheme {
  id: string;
  name: string;
  contractVersion: number;
  base: ThemeValues;
  css: string;
}

export interface AppearanceSnapshot {
  revision: number;
  builtIn: ThemeValues;
  selected: string | null;
  imports: AuthorTheme[];
  warning?: string | null;
}

export interface AuthorThemePreview {
  token: string;
  expiresAt: number;
  candidate: AppearanceSnapshot;
}

export const MAX_THEME_FILE_BYTES = 256 * 1024;

export function selectedAuthorTheme(snapshot: AppearanceSnapshot | undefined): AuthorTheme | undefined {
  return snapshot?.imports.find((entry) => entry.id === snapshot.selected);
}

/** Entire generated declarations are replaced together; only engine-owned inputs enter here. */
export function generatedThemeStyles(tokens: Record<string, string>): string {
  return `@layer theme.generated { :root { ${Object.entries(tokens)
    .map(([key, value]) => `${key}: ${value};`)
    .join('\n')} } }`;
}

/** A late response must never restore a selection superseded by another window. */
export function isCurrentAppearance(
  current: AppearanceSnapshot | undefined,
  incoming: AppearanceSnapshot,
): boolean {
  return !current || incoming.revision >= current.revision;
}
