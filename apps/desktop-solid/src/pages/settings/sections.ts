export const sections = ['general', 'appearance', 'account', 'java', 'advanced'] as const;
export type SectionId = (typeof sections)[number];

import type { MessageId } from '../../localization/messages';

export const sectionLabels: Record<string, MessageId> = {
  general: 'settings.general',
  appearance: 'settings.appearance',
  account: 'settings.account',
  java: 'settings.java',
  advanced: 'settings.advanced',
};

export const isSection = (value: string | undefined): value is SectionId => sections.includes(value as SectionId);
