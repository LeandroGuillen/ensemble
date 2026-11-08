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

/**
 * True when Enter/Space on this target already activates a control of its own
 * (a button, link, card or menu item). List-level "open the highlighted item"
 * shortcuts must leave those keys to the focused control.
 */
export function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target === document.body) {
    return false;
  }
  return !!target.closest(
    'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="tab"]'
  );
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

/**
 * Selector for app overlays that own the keyboard while open: modal frames
 * (including confirmation dialogs), the command palette, the shortcuts dialog
 * and any other `aria-modal` dialog.
 */
export const BLOCKING_DIALOG_SELECTOR =
  '.modal-overlay, .command-palette-backdrop, .shortcuts-backdrop, [role="dialog"][aria-modal="true"]';

/**
 * True while a modal, confirmation, command palette or shortcuts dialog is open.
 * Page-level document shortcuts (letters, arrows, Enter) must do nothing then,
 * so a stray key cannot act on the page behind a live dialog.
 */
export function isBlockingDialogOpen(root: ParentNode = document): boolean {
  return !!root.querySelector(BLOCKING_DIALOG_SELECTOR);
}
