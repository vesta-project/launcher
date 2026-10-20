// Run in the Vite fixture: await (await import('/checks/library-group-menu.browser.mjs')).runGroupMenu()
import { onboarding } from '../src/features/onboarding/index.ts';
import { navigate } from '../src/app/router.ts';
import { createGroup, libraryLayoutStore as store, endLibraryArrange } from '../src/features/instances/library-layout.ts';
const check = (condition, message) => { if (!condition) throw new Error(message); };
const wait = async (read) => {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const value = read(); if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Group menu UI wait timed out');
};
const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
export async function runGroupMenu() {
  check(!window.__TAURI_INTERNALS__, 'Use fixture data only');
  if (onboarding.status() !== 'done') await onboarding.continueAsGuest();
  navigate('/library'); await store.load();
  const saved = store.layout(), id = 'group:menu-regression';
  const tile = () => document.querySelector(`[data-folder-tile="${id}"]`);
  const select = async (label) => {
    const target = await wait(tile);
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    const item = await wait(() => [...document.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent === label));
    check(!item.hasAttribute('data-disabled'), `${label} should be enabled`);
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
  };
  try {
    store.preview(createGroup(saved, ['survival', 'create'], ['survival', 'create'], id, 'Menu regression'));
    await select('Open group');
    await wait(() => document.querySelector(`[data-folder-popup="${id}"]`));
    document.querySelector('[data-vesta="dialog-header"] button').click(); await settle();
    await select('Edit name and colour');
    const input = await wait(() => document.querySelector('[data-vesta="library-folder-name"]'));
    input.value = 'Renamed group'; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => store.layout().groups.find((group) => group.id === id)?.name === 'Renamed group');
    const pink = document.querySelector('[data-vesta="library-folder-color"][aria-label="Pink"]');
    pink.click(); await settle();
    check(store.layout().groups.find((group) => group.id === id)?.name === 'Renamed group', 'Rename should persist');
    check(store.layout().groups.find((group) => group.id === id)?.color === 330, 'Recolour should persist');
    document.querySelector('[data-vesta="dialog-header"] button').click(); await settle();
    endLibraryArrange();
    await select('Move later');
    check(store.layout().order.indexOf(id) > 0, 'Group should reorder');
    await select('Ungroup instances');
    await wait(() => !tile());
    check(!store.layout().groups.some((group) => group.id === id), 'Ungroup removes only the group');
    check(store.layout().order.includes('survival') && store.layout().order.includes('create'), 'Members should return to the grid');
    await store.flush();
    return 'Open, edit/rename/recolour, reorder and ungroup actions passed';
  } finally {
    document.querySelector('[data-vesta="dialog-header"] button')?.click();
    endLibraryArrange(); store.commit(saved); await store.flush();
  }
}
