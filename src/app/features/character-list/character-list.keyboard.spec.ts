import { CharacterListComponent } from './character-list.component';

describe('CharacterListComponent keyboard', () => {
  let component: CharacterListComponent;
  let createNewCharacter: jasmine.Spy;
  let toggleViewMode: jasmine.Spy;
  let editCharacter: jasmine.Spy;
  let scrollToSelectedCharacter: jasmine.Spy;

  beforeEach(() => {
    createNewCharacter = jasmine.createSpy('createNewCharacter');
    toggleViewMode = jasmine.createSpy('toggleViewMode');
    editCharacter = jasmine.createSpy('editCharacter');
    scrollToSelectedCharacter = jasmine.createSpy('scrollToSelectedCharacter');

    component = Object.create(CharacterListComponent.prototype);
    Object.assign(component, {
      filteredCharacters: [
        { id: 'a', name: 'Ada' },
        { id: 'b', name: 'Bea' },
        { id: 'c', name: 'Cora' },
      ],
      groupBy: 'none',
      groupedCharacters: [],
      groupedByTag: [],
      groupedByCast: [],
      groupedByBook: [],
      selectedCharacterIndex: -1,
      createNewCharacter,
      toggleViewMode,
      editCharacter,
      scrollToSelectedCharacter,
    });
  });

  function key(
    keyName: string,
    opts: Partial<KeyboardEvent> & { target?: EventTarget | null } = {}
  ): KeyboardEvent {
    return {
      key: keyName,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: jasmine.createSpy('preventDefault'),
      target: opts.target ?? document.createElement('div'),
      ...opts,
    } as unknown as KeyboardEvent;
  }

  it('moves selection with ArrowDown/ArrowUp and opens with Enter', () => {
    component.handleKeyboardEvent(key('ArrowDown'));
    expect(component.selectedCharacterIndex).toBe(0);
    expect(scrollToSelectedCharacter).toHaveBeenCalled();

    component.handleKeyboardEvent(key('ArrowDown'));
    expect(component.selectedCharacterIndex).toBe(1);

    component.handleKeyboardEvent(key('ArrowUp'));
    expect(component.selectedCharacterIndex).toBe(0);

    component.handleKeyboardEvent(key('Enter'));
    expect(editCharacter).toHaveBeenCalledWith(component.filteredCharacters[0]);
  });

  it('ignores N and L when Ctrl/Alt/Meta is held', () => {
    component.handleKeyboardEvent(key('n', { ctrlKey: true }));
    component.handleKeyboardEvent(key('n', { altKey: true }));
    component.handleKeyboardEvent(key('n', { metaKey: true }));
    component.handleKeyboardEvent(key('l', { ctrlKey: true }));
    expect(createNewCharacter).not.toHaveBeenCalled();
    expect(toggleViewMode).not.toHaveBeenCalled();
  });

  it('ignores shortcuts when focus is in an editable field', () => {
    const input = document.createElement('input');
    component.handleKeyboardEvent(key('n', { target: input }));
    component.handleKeyboardEvent(key('ArrowDown', { target: input }));
    expect(createNewCharacter).not.toHaveBeenCalled();
    expect(component.selectedCharacterIndex).toBe(-1);

    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    component.handleKeyboardEvent(key('l', { target: editable }));
    expect(toggleViewMode).not.toHaveBeenCalled();
  });

  it('creates and toggles view with plain N/L', () => {
    component.handleKeyboardEvent(key('N'));
    component.handleKeyboardEvent(key('l'));
    expect(createNewCharacter).toHaveBeenCalled();
    expect(toggleViewMode).toHaveBeenCalled();
  });

  describe('while a dialog is open', () => {
    let overlay: HTMLElement | null = null;

    function openDialog(className: string, attrs: Record<string, string> = {}): void {
      overlay = document.createElement('div');
      overlay.className = className;
      for (const [name, value] of Object.entries(attrs)) {
        overlay.setAttribute(name, value);
      }
      document.body.appendChild(overlay);
    }

    afterEach(() => {
      overlay?.remove();
      overlay = null;
    });

    for (const [label, cls, attrs] of [
      ['confirmation (modal frame)', 'modal-overlay', {}],
      ['command palette', 'command-palette-backdrop', {}],
      ['shortcuts dialog', 'shortcuts-backdrop', {}],
      ['aria-modal dialog', 'image-picker-dialog', { role: 'dialog', 'aria-modal': 'true' }],
    ] as const) {
      it(`ignores N, L, arrows and Enter while a ${label} is open`, () => {
        openDialog(cls, attrs as Record<string, string>);
        const cancel = document.createElement('button');
        overlay!.appendChild(cancel);
        component.selectedCharacterIndex = 0;

        const n = key('n', { target: cancel });
        component.handleKeyboardEvent(n);
        component.handleKeyboardEvent(key('l', { target: cancel }));
        component.handleKeyboardEvent(key('ArrowDown', { target: cancel }));
        component.handleKeyboardEvent(key('ArrowUp', { target: cancel }));
        component.handleKeyboardEvent(key('Enter', { target: document.body }));

        expect(createNewCharacter).not.toHaveBeenCalled();
        expect(toggleViewMode).not.toHaveBeenCalled();
        expect(editCharacter).not.toHaveBeenCalled();
        expect(scrollToSelectedCharacter).not.toHaveBeenCalled();
        expect(component.selectedCharacterIndex).toBe(0);
        expect(n.preventDefault).not.toHaveBeenCalled();
      });
    }

    it('handles shortcuts again once the dialog closes', () => {
      openDialog('modal-overlay');
      component.handleKeyboardEvent(key('n'));
      expect(createNewCharacter).not.toHaveBeenCalled();

      overlay!.remove();
      component.handleKeyboardEvent(key('n'));
      expect(createNewCharacter).toHaveBeenCalledTimes(1);
    });
  });
});
