/**
 * Single source of truth for advertised keyboard shortcuts.
 * Only list shortcuts that the app actually handles.
 */

export interface Shortcut {
  keys: string[];
  description: string;
  category: string;
}

/** Ordered registry consumed by the shortcuts dialog. */
export const SHORTCUT_REGISTRY: readonly Shortcut[] = [
  // Global
  { keys: ['Ctrl', 'P'], description: 'Open command palette', category: 'Global' },
  { keys: ['/'], description: 'Open command palette', category: 'Global' },
  { keys: ['Ctrl', '?'], description: 'Show keyboard shortcuts', category: 'Global' },
  { keys: ['Esc'], description: 'Close dialogs and cancel actions', category: 'Global' },

  // Character List
  { keys: ['N'], description: 'Create new character', category: 'Character List' },
  { keys: ['L'], description: 'Toggle list/grid view', category: 'Character List' },
  { keys: ['Enter'], description: 'Open selected character', category: 'Character List' },
  { keys: ['↑', '↓'], description: 'Navigate characters', category: 'Character List' },

  // Lore (same CharacterListComponent, lore collection)
  { keys: ['N'], description: 'Create new lore figure', category: 'Lore' },
  { keys: ['L'], description: 'Toggle list/grid view', category: 'Lore' },
  { keys: ['Enter'], description: 'Open selected lore figure', category: 'Lore' },
  { keys: ['↑', '↓'], description: 'Navigate lore figures', category: 'Lore' },

  // Drawer (same CharacterListComponent, drafts)
  { keys: ['N'], description: 'Create new draft', category: 'Drawer' },
  { keys: ['L'], description: 'Toggle list/grid view', category: 'Drawer' },
  { keys: ['Enter'], description: 'Open selected draft', category: 'Drawer' },
  { keys: ['↑', '↓'], description: 'Navigate drafts', category: 'Drawer' },

  // Character Detail
  { keys: ['Ctrl', 'Enter'], description: 'Save character', category: 'Character Detail' },
  { keys: ['Esc'], description: 'Cancel editing', category: 'Character Detail' },

  // Location List
  { keys: ['N'], description: 'Create new location', category: 'Location List' },
  { keys: ['L'], description: 'Toggle list/grid view', category: 'Location List' },
  { keys: ['Enter'], description: 'Open selected location', category: 'Location List' },
  { keys: ['↑', '↓'], description: 'Navigate locations', category: 'Location List' },

  // Location Detail
  { keys: ['Ctrl', 'Enter'], description: 'Save location', category: 'Location Detail' },
  { keys: ['Esc'], description: 'Cancel editing', category: 'Location Detail' },

  // House List
  { keys: ['N'], description: 'Create new house', category: 'House List' },
  { keys: ['Enter'], description: 'Open selected house', category: 'House List' },
  { keys: ['↑', '↓'], description: 'Navigate houses', category: 'House List' },

  // House Detail
  { keys: ['Ctrl', 'Enter'], description: 'Save house', category: 'House Detail' },

  // Book Plan
  { keys: ['Ctrl', 'J'], description: 'Search plan (2180, @character, !todo, !oculto…)', category: 'Book Plan' },
  { keys: ['PgUp/PgDn'], description: 'Previous / next chapter (focus mode)', category: 'Book Plan' },
  { keys: ['Alt', 'Shift', 'PgUp/PgDn'], description: 'Previous / next heading (scenes included)', category: 'Book Plan' },
  { keys: ['Ctrl', '.'], description: 'Toggle focus on the current chapter', category: 'Book Plan' },
  { keys: ['Ctrl', 'Alt', '←/→'], description: 'Back / forward through jumps', category: 'Book Plan' },

  // Concepts
  { keys: ['Ctrl', 'N'], description: 'Add new concept', category: 'Concepts' },
  { keys: ['Ctrl', 'F'], description: 'Focus search', category: 'Concepts' },
  { keys: ['↑', '↓'], description: 'Navigate concepts', category: 'Concepts' },
  { keys: ['Enter'], description: 'Select concept', category: 'Concepts' },

  // Names
  { keys: ['Ctrl', 'N'], description: 'Add new name list', category: 'Names' },
  { keys: ['Ctrl', 'F'], description: 'Focus search', category: 'Names' },
  { keys: ['↑', '↓'], description: 'Navigate name lists / names', category: 'Names' },
  { keys: ['Enter'], description: 'Edit selected name', category: 'Names' },
  { keys: ['C'], description: 'Edit name comment', category: 'Names' },
  { keys: ['S'], description: 'Toggle strikethrough', category: 'Names' },
  { keys: ['N'], description: 'Focus add-name input', category: 'Names' },
  { keys: ['Del'], description: 'Delete selected name', category: 'Names' },

  // Pinboard
  { keys: ['P'], description: 'Pin character', category: 'Pinboard' },
  { keys: ['Esc'], description: 'Close dialogs', category: 'Pinboard' },

  // Plot Board
  { keys: ['T'], description: 'Add thread', category: 'Plot Board' },
  { keys: ['R'], description: 'Add row', category: 'Plot Board' },
  { keys: ['↑', '↓', '←', '→'], description: 'Move cell focus', category: 'Plot Board' },
  { keys: ['Enter'], description: 'Edit focused cell', category: 'Plot Board' },

  // Command Palette
  { keys: ['↑', '↓'], description: 'Navigate commands', category: 'Command Palette' },
  { keys: ['Enter'], description: 'Execute selected command', category: 'Command Palette' },
  { keys: ['Esc'], description: 'Close command palette', category: 'Command Palette' },
];
