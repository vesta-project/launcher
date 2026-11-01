/**
 * Split frame detection. Author themes colour the titlebar and the rail by selector
 * (`[data-vesta=titlebar]`, `[data-vesta=rail]`), so CSS alone cannot tell whether they differ.
 * When their resolved backgrounds differ, the shell is marked `data-frame="split"` and the
 * titlebar colour is published as `--shell-titlebar-fill`: the gutter around the content sheet
 * then continues the titlebar colour and only the rail column keeps the rail colour (board.css).
 */
export function watchFrameSplit(shell: HTMLElement): () => void {
  const titlebar = shell.querySelector<HTMLElement>('[data-vesta="titlebar"]');
  const rail = shell.querySelector<HTMLElement>('[data-vesta="rail"]');
  if (!titlebar || !rail) return () => {};
  let frame = 0;
  const measure = () => {
    frame = 0;
    const fill = getComputedStyle(titlebar).backgroundColor;
    if (fill !== getComputedStyle(rail).backgroundColor) {
      shell.dataset.frame = 'split';
      shell.style.setProperty('--shell-titlebar-fill', fill);
    } else {
      delete shell.dataset.frame;
      shell.style.removeProperty('--shell-titlebar-fill');
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
  // Theme, scheme, material and effect changes land as root attributes or theme stylesheet text.
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { attributes: true });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  measure();
  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
