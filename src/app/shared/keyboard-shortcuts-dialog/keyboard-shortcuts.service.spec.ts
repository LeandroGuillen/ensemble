import { KeyboardShortcutsService } from './keyboard-shortcuts.service';
import { SHORTCUT_REGISTRY } from './shortcut-registry';

describe('KeyboardShortcutsService registry', () => {
  let service: KeyboardShortcutsService;

  beforeEach(() => {
    service = new KeyboardShortcutsService();
  });

  it('lists every registry shortcut including Houses, Lore, Drawer and Plot Board', () => {
    const shortcuts = service.getAllShortcuts();
    const categories = new Set(shortcuts.map((s) => s.category));

    expect(categories.has('House List')).toBeTrue();
    expect(categories.has('Lore')).toBeTrue();
    expect(categories.has('Drawer')).toBeTrue();
    expect(categories.has('Plot Board')).toBeTrue();
    expect(categories.has('Character List')).toBeTrue();
    expect(categories.has('Pinboard')).toBeTrue();

    expect(shortcuts.length).toBe(SHORTCUT_REGISTRY.length);
    expect(shortcuts.find((s) => s.category === 'Character List' && s.keys.includes('↑'))).toBeTruthy();
  });

  it('returns copies so callers cannot mutate the registry', () => {
    const first = service.getAllShortcuts();
    first[0].keys.push('MUTATED');
    first[0].description = 'mutated';
    const second = service.getAllShortcuts();
    expect(second[0].keys).toEqual(SHORTCUT_REGISTRY[0].keys);
    expect(second[0].description).toBe(SHORTCUT_REGISTRY[0].description);
  });
});
