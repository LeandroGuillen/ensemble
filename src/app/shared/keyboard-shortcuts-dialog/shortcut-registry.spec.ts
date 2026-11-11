import { SHORTCUT_REGISTRY } from './shortcut-registry';

describe('Project text search shortcut', () => {
  it('advertises Ctrl+Shift+F in the global shortcuts', () => {
    expect(SHORTCUT_REGISTRY.some(shortcut =>
      shortcut.category === 'Global' && shortcut.keys.join('+') === 'Ctrl+Shift+F'
    )).toBeTrue();
  });
});
