/** Search the entire catalogue before bounding the collection handed to Kobalte.
 * Keep the selection available for label/hidden-select synchronization, even
 * when it is outside the first page or does not match the current search.
 */
export function boundOptions<T>(options: T[], matches: (option: T) => boolean, selected: T | undefined, limit: number | undefined): T[] {
  if (limit === undefined) return options;
  const result: T[] = [];
  const count = Math.max(1, Math.floor(limit));
  for (const option of options) {
    if (matches(option)) result.push(option);
    if (result.length >= count) break;
  }
  if (selected && !result.includes(selected)) result.push(selected);
  return result;
}

/**
 * Long lists are drawn a page at a time: each item costs a few milliseconds to build, so a few
 * hundred versions drawn at once kept a menu from opening for seconds. The first page shows at
 * once, the next is drawn as you scroll towards the end, and search always covers every option.
 */
export const LONG_LIST = 60;
export const PAGE_SIZE = 30;
/** How close to the bottom (px) scrolling has to get before the next page is drawn. */
const REVEAL_DISTANCE = 480;

export const nearEnd = (menu: HTMLElement) => menu.scrollHeight - menu.scrollTop - menu.clientHeight < REVEAL_DISTANCE;
