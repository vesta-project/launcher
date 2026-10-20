// Run in the fixture-backed Vite preview:
// await (await import('/checks/ui-followups.browser.mjs')).runUiFollowups()
// This drives the real mounted app; it never invokes native resource installation.
const check = (value, message) => { if (!value) throw new Error(message); };
const waitFor = async (read) => {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    const value = read(); if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the UI');
};
const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
export async function runUiFollowups() {
  const { isTauri } = await import('@tauri-apps/api/core');
  check(!isTauri(), 'Run these checks in the browser fixture, not a native profile');
  const { onboarding } = await import('../src/features/onboarding/index.ts');
  if (onboarding.status() !== 'done') await onboarding.continueAsGuest();
  const { navigate } = await import('../src/app/router.ts');
  const config = await import('../src/features/settings/config.ts');
  const results = [];
  document.querySelector('[data-vesta="dialog-header"] button')?.click();
  navigate('/library');
  const pin = await waitFor(() => document.querySelector('[data-vesta="rail-pin-image"]'));
  let loads = 0;
  const loaded = () => loads++;
  pin.addEventListener('load', loaded);
  const hue = config.setting('theme_primary_hue');
  try {
    config.updateSetting('theme_primary_hue', (hue + 65) % 360);
    await settle();
    check(pin === document.querySelector('[data-vesta="rail-pin-image"]'), 'Theme change remounted pinned artwork');
    check(loads === 0, 'Theme change reloaded pinned artwork');
    results.push('theme changes preserve pinned image');
  } finally { pin.removeEventListener('load', loaded); config.updateSetting('theme_primary_hue', hue); }

  navigate('/browse/project/modrinth/sodium');
  const rich = await waitFor(() => document.querySelector('[data-vesta="rich-text"]'));
  // The fixture description has no photos. Insert one to test the real panel's DOM lifetime.
  const image = document.createElement('img'); image.src = pin.src; image.alt = 'Regression fixture'; rich.append(image);
  await waitFor(() => image.complete);
  const tabs = [...document.querySelectorAll('.project-tabs [data-vesta="tab"]')];
  tabs.find((tab) => tab.textContent.includes('Versions')).click(); await settle();
  check(getComputedStyle(rich.closest('[data-vesta="tab-panel"]')).display === 'none', 'Inactive overview remains visible');
  tabs.find((tab) => tab.textContent.includes('Description')).click(); await settle();
  check(rich === document.querySelector('[data-vesta="rich-text"]') && image.isConnected, 'Tab switch replaced overview images');
  image.remove(); results.push('overview and image survive tab round trip');

  for (const id of ['library', 'create', 'browse', 'settings']) {
    const link = document.querySelector(`[data-vesta="rail-button"][href="#/${id}"]`);
    link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 100 }));
    await waitFor(() => document.querySelector('[role="menuitem"]'));
    check(document.querySelectorAll('[role="menuitem"]').length >= 3, `${id} has no useful context actions`);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
  }
  results.push('four rail destination menus open');

  navigate('/settings/about');
  const view = await waitFor(() => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'View'));
  view.click();
  await waitFor(() => document.querySelectorAll('[data-vesta="changelog-version"]').length > 1);
  const versions = [...document.querySelectorAll('[data-vesta="changelog-version"]')];
  versions[1].click(); await settle();
  check(document.querySelector('[data-vesta="changelog-release"]').dataset.tag === versions[1].querySelector('[data-vesta="changelog-version-tag"]').textContent, 'Changelog selection did not change notes');
  check(versions.every((version) => version.getBoundingClientRect().height >= 30), 'Changelog version rows collapsed');
  check(getComputedStyle(document.querySelector('.changelog-dialog > [data-vesta="dialog-body"]')).overflowY === 'hidden', 'Outer changelog body scrolls');
  document.querySelector('.changelog-dialog [data-vesta="dialog-header"] button').click();
  results.push('changelog selects releases and bounds scrolling');

  navigate('/library/survival/settings');
  const edit = await waitFor(() => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Edit…'));
  check(!edit.disabled, 'Minecraft options are still disabled'); edit.click();
  const group = await waitFor(() => document.querySelector('.game-options-dialog [data-vesta="prefs-sync-group"] button'));
  group.click(); await settle();
  check(document.querySelectorAll('.game-options-dialog [data-vesta="prefs-sync-control"]').length > 0, 'Instance option values did not render');
  check(!document.querySelector('.game-options-dialog [data-vesta="checkbox"]'), 'Instance editor exposes sync selections');
  document.querySelector('.game-options-dialog [data-vesta="dialog-header"] button').click();
  results.push('instance editor renders typed controls without sync selection');
  return results;
}

export async function runClassicThemeChecks() {
  check(!window.__TAURI_INTERNALS__, 'Run in the browser fixture');
  const { onboarding } = await import('../src/features/onboarding/index.ts');
  if (onboarding.status() !== 'done') await onboarding.continueAsGuest();
  const { navigate } = await import('../src/app/router.ts');
  const config = await import('../src/features/settings/config.ts');
  const scheme = config.setting('theme');
  const classic = (await import('../src/styles/themes/windows-2000.css?raw')).default;
  const style = document.createElement('style');
  try {
    config.updateSetting('theme', 'light'); navigate('/settings/appearance');
    await waitFor(() => document.querySelectorAll('[data-vesta="prefs-theme-preview"]').length > 3);
    await settle();
    const previews = [...document.querySelectorAll('[data-vesta="prefs-theme-preview"]')];
    const hues = previews.map((tile) => getComputedStyle(tile).getPropertyValue('--vesta-accent-h').trim());
    check(new Set(hues).size > 2, 'Light preset previews all inherited the root hue');
    const colours = previews.map((tile) => getComputedStyle(tile).getPropertyValue('--vesta-color-accent').trim());
    style.textContent = classic.replaceAll("[data-vesta-theme-example='windows-2000']", ':root');
    document.head.append(style); await settle();
    check(getComputedStyle(document.querySelector('[data-vesta="shell"]')).backgroundColor === 'rgb(58, 110, 165)', 'Classic desktop blue did not apply');
    const board = getComputedStyle(document.querySelector('[data-vesta="board"]'));
    check(board.backgroundColor === 'rgb(212, 208, 200)', 'Classic board kept the generated palette');
    check(board.boxShadow !== 'none', 'Classic board has no recessed border');
    check(previews.every((tile, index) => getComputedStyle(tile).getPropertyValue('--vesta-color-accent').trim() === colours[index]), 'Author theme recoloured preset previews');
    return ['light previews resolve their own hue', 'classic canvas and board use explicit colours', 'board has a recessed edge', 'preset previews retain their own colours'];
  } finally { style.remove(); config.updateSetting('theme', scheme); }
}
