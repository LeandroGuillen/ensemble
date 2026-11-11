export type SettingsSectionId =
  | 'project-health'
  | 'general'
  | 'appearance'
  | 'categories'
  | 'tags'
  | 'character-styles'
  | 'ai'
  | 'image-generation'
  | 'backup'
  | 'timeline';

/** Legacy / alias query values mapped to current section ids. */
export const SETTINGS_SECTION_ALIASES: Record<string, SettingsSectionId> = {
  'project-defaults': 'general',
  'project-structure': 'general',
  project: 'general',
  characters: 'categories',
};

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'general';

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = [
  'general',
  'project-health',
  'appearance',
  'categories',
  'tags',
  'character-styles',
  'ai',
  'image-generation',
  'backup',
  'timeline',
] as const;
