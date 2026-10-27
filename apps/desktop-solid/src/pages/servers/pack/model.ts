import type { PackPreview, PackPublish } from '../../../features/servers/native-pack';
import type { PackSyncPreview } from '../../../features/servers/native-pack-sync';
export function publishRequest(review: PackPreview, requiredUpdate: boolean, acknowledgeLowerVersion: boolean): PackPublish {
  return { expectedRevision: review.publishedRevision, draftRevision: review.draftRevision, resolvedEntries: review.resolvedEntries, reviewSha256: review.reviewSha256, requiredUpdate, acknowledgeLowerVersion };
}
export function syncRequest(review: PackSyncPreview, consent: boolean, linkOnly: boolean) {
  if (review.consentRequired && !consent && !linkOnly) throw new Error('Executable consent required');
  return { reviewId: review.reviewId, consentRevision: consent ? review.revision : null, linkOnly, name: review.name };
}
