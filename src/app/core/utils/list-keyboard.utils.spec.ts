import {
  hasShortcutModifier,
  isEditableKeyboardTarget,
  moveListSelection,
  plainLetterKey,
} from './list-keyboard.utils';

describe('list-keyboard.utils', () => {
  describe('isEditableKeyboardTarget', () => {
    it('treats input, textarea, select and contenteditable as editable', () => {
      const input = document.createElement('input');
      const textarea = document.createElement('textarea');
      const select = document.createElement('select');
      const editable = document.createElement('div');
      editable.contentEditable = 'true';
      const nested = document.createElement('span');
      const host = document.createElement('div');
      host.setAttribute('contenteditable', 'true');
      host.appendChild(nested);

      expect(isEditableKeyboardTarget(input)).toBeTrue();
      expect(isEditableKeyboardTarget(textarea)).toBeTrue();
      expect(isEditableKeyboardTarget(select)).toBeTrue();
      expect(isEditableKeyboardTarget(editable)).toBeTrue();
      expect(isEditableKeyboardTarget(nested)).toBeTrue();
      expect(isEditableKeyboardTarget(document.createElement('div'))).toBeFalse();
      expect(isEditableKeyboardTarget(null)).toBeFalse();
    });
  });

  describe('hasShortcutModifier / plainLetterKey', () => {
    it('ignores Ctrl, Alt and Meta for single-letter shortcuts', () => {
      expect(hasShortcutModifier({ ctrlKey: true, altKey: false, metaKey: false })).toBeTrue();
      expect(hasShortcutModifier({ ctrlKey: false, altKey: true, metaKey: false })).toBeTrue();
      expect(hasShortcutModifier({ ctrlKey: false, altKey: false, metaKey: true })).toBeTrue();
      expect(hasShortcutModifier({ ctrlKey: false, altKey: false, metaKey: false })).toBeFalse();

      const plain = { key: 'n', ctrlKey: false, altKey: false, metaKey: false, keyLength: 1 } as any;
      plain.key = 'N';
      expect(plainLetterKey(plain as KeyboardEvent)).toBe('n');

      expect(
        plainLetterKey({ key: 'n', ctrlKey: true, altKey: false, metaKey: false } as KeyboardEvent)
      ).toBeNull();
      expect(
        plainLetterKey({ key: 'Enter', ctrlKey: false, altKey: false, metaKey: false } as KeyboardEvent)
      ).toBeNull();
    });
  });

  describe('moveListSelection', () => {
    it('wraps and seeds from an empty selection', () => {
      expect(moveListSelection(-1, 'down', 3)).toBe(0);
      expect(moveListSelection(-1, 'up', 3)).toBe(2);
      expect(moveListSelection(2, 'down', 3)).toBe(0);
      expect(moveListSelection(0, 'up', 3)).toBe(2);
      expect(moveListSelection(1, 'down', 3)).toBe(2);
      expect(moveListSelection(0, 'down', 0)).toBe(-1);
    });
  });
});
