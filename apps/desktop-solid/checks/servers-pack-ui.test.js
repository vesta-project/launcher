import { describe, test, expect } from 'bun:test';
import { publishRequest, syncRequest } from '../src/pages/servers/pack/model.ts';

describe('client pack UI review binding', () => {
  test('publishing uses exact reviewed hashes, resolved entries and decimal revisions', () => {
    const review = { publishedRevision: '9007199254740993', draftRevision: '9007199254740995', resolvedEntries: [{ id: 'resolver-added-dependency' }], reviewSha256: 'review-hash' };
    const request = publishRequest(review, true, false);
    expect(request).toEqual({ expectedRevision: review.publishedRevision, draftRevision: review.draftRevision, resolvedEntries: review.resolvedEntries, reviewSha256: 'review-hash', requiredUpdate: true, acknowledgeLowerVersion: false });
    expect(publishRequest({ ...review, reviewSha256: 'new-review' }, false, true).reviewSha256).toBe('new-review');
  });
  test('executable installation needs explicit exact revision consent', () => {
    const review = { reviewId: 'single-use', revision: '9007199254740999', name: 'Client', consentRequired: true };
    expect(() => syncRequest(review, false, false)).toThrow('Executable consent required');
    expect(syncRequest(review, true, false)).toEqual({ reviewId: 'single-use', consentRevision: review.revision, name: 'Client', linkOnly: false });
    expect(syncRequest({ ...review, reviewId: 'other', revision: '12' }, true, false).consentRevision).toBe('12');
  });
  test('noninstalling exact-file linkage carries no executable consent', () => {
    const request = syncRequest({ reviewId: 'exact', revision: '8', name: 'Client', consentRequired: true }, false, true);
    expect(request.linkOnly).toBe(true); expect(request.consentRevision).toBeNull();
  });
});
