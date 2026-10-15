export const sections = ['general', 'appearance', 'account', 'java', 'advanced'] as const;
export type SectionId = (typeof sections)[number];

export const sectionLabels: Record<string, string> = {
  general: 'General',
  appearance: 'Appearance',
  account: 'Account',
  java: 'Java',
  advanced: 'Advanced',
};

export const isSection = (value: string | undefined): value is SectionId => sections.includes(value as SectionId);
