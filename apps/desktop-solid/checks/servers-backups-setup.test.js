import { describe, expect, test } from 'bun:test';
import {
  backupsTabVisible, diffCount, draftDiff, draftValid, editDraft, keepsEverything, nextProfileName, parseList, profileName,
  profileProblems, retentionValid, setupDraft, suggestedProfile,
} from '../src/features/servers/backup-setup-model';
import { visibleMainTabs } from '../src/features/servers/shell-model';

const caps = (granted, refused = []) => ({ source: 'agent', granted, refused });
const tabIds = (capabilities, backupsConfigured, requested) => visibleMainTabs({ snapshot: { capabilities }, backupsConfigured, requested }).map((tab) => tab.id);

describe('backups tab visibility', () => {
  test('shown when configured or configurable, hidden only when neither', () => {
    expect(backupsTabVisible(true, false)).toBe(true);
    expect(backupsTabVisible(false, true)).toBe(true);
    expect(backupsTabVisible(false, false)).toBe(false);
    expect(backupsTabVisible(undefined, false)).toBe(false);
    expect(backupsTabVisible(undefined, false, true)).toBe(true);
  });
  test('the shell applies it to owners and viewers', () => {
    expect(tabIds(caps(['backups.view', 'backups.configure']), false)).toContain('backups');
    expect(tabIds(caps(['backups.view']), false)).not.toContain('backups');
    expect(tabIds(caps(['backups.view']), true)).toContain('backups');
    expect(tabIds(caps(['backups.view'], ['backups.configure']), undefined, 'backups')).toContain('backups');
  });
});

describe('setup draft', () => {
  const unconfigured = { limits: { maxSnapshots: null, maxRepositoryBytes: null, minFreeBytes: 1 }, repository: { kind: 'local', location: 'x', initialized: false } };
  test('suggests one online daily profile keeping the newest 14, of the whole game', () => {
    const draft = setupDraft(unconfigured);
    expect(draft.initializeRepository).toBe(true);
    expect(draft.profiles).toHaveLength(1);
    expect(draft.profiles[0]).toMatchObject({ name: 'daily', mode: 'online', keepTotal: 0, keepHourly: 0, keepLast: 14, keepDaily: 0, keepWeekly: 0, keepMonthly: 0, include: [], exclude: [] });
    expect(draftValid(draft)).toBe(true);
    expect(setupDraft({ ...unconfigured, repository: { ...unconfigured.repository, initialized: true } }).initializeRepository).toBe(false);
  });
  test('editing never re-initializes and copies lists', () => {
    const profile = { ...suggestedProfile(), include: ['world'] };
    const draft = editDraft({ limits: unconfigured.limits, profiles: [profile] });
    draft.profiles[0].include.push('config');
    expect(profile.include).toEqual(['world']);
    expect(draft.initializeRepository).toBe(false);
  });
  test('names', () => {
    expect(profileName('  Before Updates! ')).toBe('before-updates');
    expect(nextProfileName(['daily', 'manual'])).toBe('manual-2');
  });
});

describe('retention and scope validation', () => {
  test('retention counts are whole numbers 0..1000', () => {
    expect(retentionValid(suggestedProfile())).toBe(true);
    expect(retentionValid({ ...suggestedProfile(), keepDaily: -1 })).toBe(false);
    expect(retentionValid({ ...suggestedProfile(), keepWeekly: 1.5 })).toBe(false);
    expect(retentionValid({ ...suggestedProfile(), keepMonthly: 1001 })).toBe(false);
    expect(keepsEverything({ keepLast: 0, keepDaily: 0, keepWeekly: 0, keepMonthly: 0 })).toBe(true);
  });
  test('problems name the field', () => {
    const daily = suggestedProfile();
    expect(profileProblems({ ...daily, name: 'Daily' }, [])).toEqual(['name']);
    expect(profileProblems(daily, [{ ...daily }])).toEqual(['name-taken']);
    expect(draftValid({ profiles: [daily, { ...daily }], limits: {}, initializeRepository: false })).toBe(false);
    expect(profileProblems({ ...daily, include: ['../secret'] }, [])).toEqual(['include']);
    expect(profileProblems({ ...daily, exclude: ['!keep'] }, [])).toEqual(['exclude']);
    expect(profileProblems({ ...daily, include: ['world', 'config'], exclude: ['logs/', '*.tmp'] }, [])).toEqual([]);
    expect(parseList(' world \r\n\nconfig\n')).toEqual(['world', 'config']);
  });
});

describe('draft diff', () => {
  const daily = suggestedProfile();
  const weekly = { ...suggestedProfile(), name: 'weekly', keepDaily: 0 };
  test('reports added, removed and changed profiles by name', () => {
    expect(diffCount(draftDiff([daily, weekly], [daily, weekly]))).toBe(0);
    expect(draftDiff([daily], [{ ...daily, keepDaily: 21 }])).toEqual({ added: [], removed: [], changed: ['daily'] });
    expect(draftDiff([daily], [daily, weekly])).toEqual({ added: ['weekly'], removed: [], changed: [] });
    expect(draftDiff([daily, weekly], [daily])).toEqual({ added: [], removed: ['weekly'], changed: [] });
    expect(draftDiff([daily], [{ ...daily, name: 'nightly' }])).toEqual({ added: ['nightly'], removed: ['daily'], changed: [] });
  });
});

import { retentionAdvanced, retentionForm, withRetention } from '../src/features/servers/backup-setup-model';
describe('retention', () => {
  const base = { ...suggestedProfile(), keepTotal: 0, keepHourly: 0, keepLast: 0, keepDaily: 0, keepWeekly: 0, keepMonthly: 0 };
  test('newest, daily and weekly map onto keep_last, keep_daily and keep_weekly', () => {
    expect(withRetention(base, { newest: 7, daily: 14, weekly: 4 })).toMatchObject({ keepLast: 7, keepDaily: 14, keepWeekly: 4, keepTotal: 0, keepHourly: 0, keepMonthly: 0 });
    for (const form of [{ newest: 20, daily: 0, weekly: 0 }, { newest: 0, daily: 7, weekly: 4 }]) {
      expect(retentionForm(withRetention(base, form))).toEqual(form);
    }
  });
  test('editing clears a total cap (it would prune daily and weekly backups) but keeps hourly and monthly', () => {
    expect(withRetention({ ...base, keepTotal: 30, keepHourly: 24, keepMonthly: 3 }, { newest: 5, daily: 7, weekly: 0 }))
      .toMatchObject({ keepTotal: 0, keepHourly: 24, keepMonthly: 3, keepLast: 5, keepDaily: 7 });
  });
  test('Advanced starts open only when something beyond the newest backups is kept', () => {
    expect(retentionAdvanced({ ...base, keepLast: 10 })).toBe(false);
    expect(retentionAdvanced({ ...base, keepTotal: 10 })).toBe(false);
    expect(retentionAdvanced({ ...base, keepDaily: 7 })).toBe(true);
    expect(retentionAdvanced({ ...base, keepWeekly: 4 })).toBe(true);
    expect(retentionAdvanced({ ...base, keepMonthly: 3 })).toBe(true);
    expect(retentionAdvanced({ ...base, keepHourly: 24 })).toBe(true);
  });
  test('validity, keeps-everything and diffs include the total and hourly counts', () => {
    expect(retentionValid({ ...base, keepTotal: 1001 })).toBe(false);
    expect(retentionValid({ ...base, keepHourly: -1 })).toBe(false);
    expect(keepsEverything({ ...base, keepTotal: 10 })).toBe(false);
    expect(keepsEverything(base)).toBe(true);
    expect(draftDiff([base], [{ ...base, keepTotal: 9 }]).changed).toEqual([base.name]);
    expect(draftDiff([{ ...base, keepTotal: undefined }], [base]).changed).toEqual([]);
  });
});
