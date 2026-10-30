/** Compare reviewed effects, excluding transport credentials and their lifetime. */
export function sameReviewedPlan(a: object, b: object): boolean {
  const content = (value: object) => Object.fromEntries(Object.entries(value).filter(([key]) => !['planId', 'confirmationToken', 'expiresAtMs'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(content(a)) === JSON.stringify(content(b));
}
