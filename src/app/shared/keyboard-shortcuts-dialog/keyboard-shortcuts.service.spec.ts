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

  it('includes markdown formatting, project selector 1–9, palette paging, and L cycle description', () => {
    const shortcuts = service.getAllShortcuts();

    const byCat = (category: string) => shortcuts.filter((s) => s.category === category);

    const md = byCat('Markdown Editor');
    expect(md.find((s) => s.keys.join('+') === 'Ctrl+B' && /bold/i.test(s.description))).toBeTruthy();
    expect(md.find((s) => s.keys.join('+') === 'Ctrl+I' && /italic/i.test(s.description))).toBeTruthy();
    expect(
      md.find((s) => s.keys.join('+') === 'Ctrl+Shift+X' && /strikethrough/i.test(s.description))
    ).toBeTruthy();
    expect(md.find((s) => s.keys.join('+') === 'Ctrl+K' && /wiki link/i.test(s.description))).toBeTruthy();

    const project = byCat('Project Selector');
    expect(project.find((s) => s.keys.includes('1–9') && /recent project/i.test(s.description))).toBeTruthy();

    const palette = byCat('Command Palette');
    expect(palette.find((s) => s.keys.includes('PgUp/PgDn'))).toBeTruthy();
    expect(palette.find((s) => s.keys.includes('Home/End'))).toBeTruthy();

    const listL = shortcuts.find((s) => s.category === 'Character List' && s.keys.includes('L'));
    expect(listL?.description).toMatch(/grid.*list.*compact.*gallery/i);
  });

  it('lists book plan Alt+PgUp/PgDn and plan-search paging / Tab group jump', () => {
    const shortcuts = service.getAllShortcuts();
    const byCat = (category: string) => shortcuts.filter((s) => s.category === category);

    const bookPlan = byCat('Book Plan');
    const altChapter = bookPlan.find(
      (s) =>
        s.keys.length === 2 &&
        s.keys[0] === 'Alt' &&
        s.keys[1] === 'PgUp/PgDn' &&
        s.description === 'Previous / next chapter'
    );
    expect(altChapter).toBeTruthy();
    // Must not be confused with Alt+Shift headings or focus-mode plain PgUp/PgDn.
    expect(
      bookPlan.find((s) => s.keys.join('+') === 'Alt+Shift+PgUp/PgDn')?.description
    ).toMatch(/heading/i);
    expect(
      bookPlan.find((s) => s.keys.length === 1 && s.keys[0] === 'PgUp/PgDn')?.description
    ).toMatch(/focus mode/i);

    const planSearch = byCat('Plan search');
    expect(
      planSearch.find(
        (s) => s.keys.join('+') === 'PgUp/PgDn' && /move selection by 10/i.test(s.description)
      )
    ).toBeTruthy();
    expect(
      planSearch.find(
        (s) =>
          s.keys.length === 1 &&
          s.keys[0] === 'Tab / Shift+Tab' &&
          /next \/ previous result group/i.test(s.description)
      )
    ).toBeTruthy();
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
