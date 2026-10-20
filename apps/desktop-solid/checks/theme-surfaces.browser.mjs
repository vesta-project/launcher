// Fixture-browser regression: await (await import('/checks/theme-surfaces.browser.mjs')).runThemeSurfaces()
import { onboarding } from '../src/features/onboarding/index.ts';
import { navigate } from '../src/app/router.ts';
import { createGroup, libraryLayoutStore } from '../src/features/instances/library-layout.ts';
import classic from '../src/styles/themes/windows-2000.css?raw';
import projectCss from '../src/pages/browse/project/project.css?raw';
import { setting, updateSetting } from '../src/features/settings/config.ts';

const check = (value, message) => { if (!value) throw new Error(message); };
const wait = async (read) => {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    const value = read(); if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('UI wait timed out');
};
const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const settlePaint = async (node) => {
  getComputedStyle(node).backgroundColor;
  await Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {})));
  await settle();
};
const close = () => document.querySelector('[data-vesta="dialog-header"] button')?.click();
async function createMenuAction(text) {
  document.querySelector('[data-vesta="rail-button"][href="#/create"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 45, clientY: 120 }));
  const item = await wait(() => [...document.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent === text));
  item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
}
function rgba(colour) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1);
  return [...ctx.getImageData(0, 0, 1, 1).data];
}
function contrast(foreground, background) {
  const luminance = (colour) => rgba(colour).slice(0, 3).map((c) => c / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export async function runThemeSurfaces() {
  check(!window.__TAURI_INTERNALS__, 'Use the browser fixture, not native data');
  if (onboarding.status() !== 'done') await onboarding.continueAsGuest();
  await wait(() => document.querySelector('[data-vesta="rail"]'));
  close();
  const results = [];
  // Exercise selection as well as opening: the primitive selects on Enter/pointerup, not .click().
  await createMenuAction('Other launcher…');
  await wait(() => document.querySelector('.install-import-launchers'));
  close(); await settle();
  await createMenuAction('Other launcher…');
  await wait(() => document.querySelector('.install-import-launchers'));
  document.querySelector('.install-import-launchers button').click();
  await wait(() => location.hash.startsWith('#/create/import/'));
  await createMenuAction('New instance');
  await wait(() => document.querySelector('[data-vesta="memory-comparison"]'));
  check(!document.querySelector('.install-import-dialog'), 'New instance inherited import state');
  results.push('launcher action opens, repeats on Create, selects a launcher; new resets');

  const scheme = setting('theme');
  const regularHover = document.createElement('style');
  regularHover.textContent = projectCss.replaceAll(':hover', '[data-regression-hover]');
  document.head.append(regularHover);
  try {
    navigate('/browse/project/modrinth/sodium');
    for (const mode of ['light', 'dark']) {
      updateSetting('theme', mode); await settle();
      const author = await wait(() => document.querySelector('[data-vesta="project-header-author"]'));
      check(contrast(getComputedStyle(author).color, '#333') >= 4.5, `${mode} banner author loses contrast`);
      const creator = await wait(() => document.querySelector('[data-vesta="project-creator"]'));
      creator.setAttribute('data-regression-hover', '');
      await settlePaint(creator);
      check(contrast(getComputedStyle(creator.querySelector('small')).color, getComputedStyle(creator).backgroundColor) >= 4.5, `${mode} creator role loses contrast`);
      creator.removeAttribute('data-regression-hover');
    }
    results.push('ordinary light and dark author/creator contrast');
  } finally { regularHover.remove(); updateSetting('theme', scheme); }
  navigate('/create');
  await wait(() => document.querySelector('[data-vesta="memory-comparison"]'));

  const style = document.createElement('style');
  style.textContent = classic.replaceAll("[data-vesta-theme-example='windows-2000']", ':root');
  document.head.append(style);
  const root = document.documentElement;
  const originals = ['--vesta-radius-container', '--vesta-radius-sm'].map((key) => [key, root.style.getPropertyValue(key)]);
  let saved;
  try {
    const memory = document.querySelector('[data-vesta="memory-comparison"] > [data-selected]');
    await settle();
    check(getComputedStyle(memory).borderRadius === '0px', 'Memory bypasses theme radius');
    check(getComputedStyle(memory).backgroundColor === 'rgb(192, 192, 192)', 'Memory ignores classic surface');
    root.style.setProperty('--vesta-radius-container', '12px'); await settle();
    check(getComputedStyle(memory).borderRadius === '12px', 'Memory cannot be configured through radius token');
    navigate('/settings/notifications');
    const feed = await wait(() => document.querySelector('[data-vesta="prefs-feed-icon"]'));
    check(feed.hasAttribute('data-vesta-icon-tile'), 'Feed marker has private styling');
    check(getComputedStyle(feed).borderRadius === '12px', 'Settings marker bypasses shared radius');
    check(getComputedStyle(feed).color === 'rgb(0, 0, 0)', 'Classic marker tone did not apply');
    navigate('/settings/java');
    const java = await wait(() => document.querySelector('[data-vesta="prefs-java-mark"]'));
    check(java.hasAttribute('data-vesta-icon-tile') && getComputedStyle(java).borderRadius === '12px', 'Java marker is not shared');
    navigate('/settings/storage');
    const bar = await wait(() => document.querySelector('[data-vesta="prefs-bar"]'));
    check(getComputedStyle(bar).borderRadius === '0px', 'Storage bar bypasses classic radius');
    check(getComputedStyle(bar).padding === '2px' && getComputedStyle(bar).boxShadow !== 'none', 'Storage has no classic frame');
    root.style.setProperty('--vesta-radius-sm', '6px'); await settle();
    check(getComputedStyle(bar).borderRadius === '6px', 'Storage radius cannot be configured');
    results.push('memory, shared markers and storage obey radius tokens and classic surfaces');

    navigate('/browse/project/modrinth/sodium');
    const author = await wait(() => document.querySelector('[data-vesta="project-header-author"]'));
    check(contrast(getComputedStyle(author).color, '#333') >= 4.5, 'Banner author became dark');
    // Reproduce hover state in a frozen stylesheet: covers muted labels and trailing icons too.
    const hover = document.createElement('style');
    hover.textContent = style.textContent.replaceAll(':hover', '[data-regression-hover]'); document.head.append(hover);
    try {
      const creator = await wait(() => document.querySelector('[data-vesta="project-creator"]'));
      creator.setAttribute('data-regression-hover', '');
      await settlePaint(creator);
      const text = creator.querySelector('small');
      check(contrast(getComputedStyle(text).color, getComputedStyle(creator).backgroundColor) >= 4.5, 'Creator role loses contrast when highlighted');
      const link = document.querySelector('[data-vesta="project-link"]'); link.setAttribute('data-regression-hover', ''); await settlePaint(link);
      check([...link.querySelectorAll('[data-vesta="icon"]')].every((icon) => contrast(getComputedStyle(icon).color, getComputedStyle(link).backgroundColor) >= 3), 'Highlighted link icons lose contrast');
      creator.removeAttribute('data-regression-hover'); link.removeAttribute('data-regression-hover');
    } finally { hover.remove(); }
    results.push('banner author, highlighted creator role and link icons retain contrast');

    navigate('/library'); await libraryLayoutStore.load();
    saved = libraryLayoutStore.layout();
    let grouped = createGroup(saved, ['survival', 'create'], ['survival', 'create'], 'group:surface-regression', 'Regression group');
    grouped = { ...grouped, groups: grouped.groups.map((group) => group.id === 'group:surface-regression' ? { ...group, color: 330 } : group) };
    libraryLayoutStore.preview(grouped);
    const tile = await wait(() => document.querySelector('[data-folder-tile="group:surface-regression"]')); tile.click();
    const dialog = await wait(() => document.querySelector('.library-folder-popup'));
    check(getComputedStyle(dialog).getPropertyValue('--library-folder-hue').trim() === '330', 'Folder hue did not reach portalled panel');
    const before = getComputedStyle(dialog).backgroundColor;
    libraryLayoutStore.preview({ ...grouped, groups: grouped.groups.map((group) => group.id === 'group:surface-regression' ? { ...group, color: 150 } : group) }); await settle();
    check(getComputedStyle(dialog).backgroundColor !== before, 'Open folder colour did not follow the selected hue');
    close(); results.push('opened folder inherits and updates its selected hue');
    return results;
  } finally {
    close(); style.remove();
    for (const [key, value] of originals) { if (value) root.style.setProperty(key, value); else root.style.removeProperty(key); }
    if (saved) libraryLayoutStore.preview(saved);
  }
}
