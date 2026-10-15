export interface WorkbenchTheme {
  id: string;
  label: string;
  css: string[];
  supportsAccentHue?: boolean;
}

// The launcher's token layer (palettes + semantic mapping).
const launcherFiles = import.meta.glob<string>('../src/styles/tokens/*.css', {
  query: '?inline',
  import: 'default',
  eager: true,
});
const launcherCss = Object.keys(launcherFiles)
  .sort()
  .map((path) => launcherFiles[path]);

export const themes: WorkbenchTheme[] = [
  { id: 'ui', label: 'UI defaults', css: [] },
  { id: 'launcher', label: 'Vesta launcher', css: [launcherCss.join('\n')], supportsAccentHue: true },
];

/** The theme CSS declares its own @layer, so it is injected unwrapped. */
export function applyTheme(theme: WorkbenchTheme) {
  let el = document.getElementById('wb-theme');
  if (!el) {
    el = document.createElement('style');
    el.id = 'wb-theme';
    document.head.appendChild(el);
  }
  el.textContent = theme.css.join('\n');
}
