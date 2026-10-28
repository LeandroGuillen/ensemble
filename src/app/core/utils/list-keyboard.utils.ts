/**
 * Shared helpers for list-page keyboard navigation and single-key shortcuts.
 */

/** True when focus is in a field where typing should not trigger page shortcuts. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return !!target.closest('[contenteditable="true"]');
}

/** True when Ctrl, Alt, or Meta is held (single-letter shortcuts must ignore these). */
export function hasShortcutModifier(event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey'>): boolean {
  return event.ctrlKey || event.altKey || event.metaKey;
}

/**
 * Move a list selection index by one step, wrapping at the ends.
 * When nothing is selected (`current < 0`), ArrowDown selects the first item
 * and ArrowUp selects the last.
 */
export function moveListSelection(current: number, direction: 'up' | 'down', length: number): number {
  if (length <= 0) {
    return -1;
  }
  if (direction === 'down') {
    if (current < 0) {
      return 0;
    }
    return current < length - 1 ? current + 1 : 0;
  }
  if (current < 0) {
    return length - 1;
  }
  return current > 0 ? current - 1 : length - 1;
}

/** Plain letter key (ignores modifiers); returns lower-case letter or null. */
export function plainLetterKey(event: KeyboardEvent): string | null {
  if (hasShortcutModifier(event) || event.key.length !== 1) {
    return null;
  }
  return event.key.toLowerCase();
}
