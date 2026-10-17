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
