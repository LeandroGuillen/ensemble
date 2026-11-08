import { LocationListComponent } from './location-list.component';

describe('LocationListComponent keyboard', () => {
  let component: LocationListComponent;
  let createNewLocation: jasmine.Spy;
  let toggleViewMode: jasmine.Spy;
  let editLocation: jasmine.Spy;
  let scrollToSelectedLocation: jasmine.Spy;

  beforeEach(() => {
    createNewLocation = jasmine.createSpy('createNewLocation');
    toggleViewMode = jasmine.createSpy('toggleViewMode');
    editLocation = jasmine.createSpy('editLocation');
    scrollToSelectedLocation = jasmine.createSpy('scrollToSelectedLocation');

    component = Object.create(LocationListComponent.prototype);
    Object.assign(component, {
      filteredLocations: [
        { id: 'a', name: 'Harbor' },
        { id: 'b', name: 'Woods' },
      ],
      selectedLocationIndex: -1,
      createNewLocation,
      toggleViewMode,
      editLocation,
      scrollToSelectedLocation,
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

  it('ignores N/L with modifiers and when typing in inputs', () => {
    component.handleKeyboardEvent(key('n', { ctrlKey: true }));
    component.handleKeyboardEvent(key('l', { metaKey: true }));
    component.handleKeyboardEvent(key('n', { target: document.createElement('textarea') }));
    expect(createNewLocation).not.toHaveBeenCalled();
    expect(toggleViewMode).not.toHaveBeenCalled();
  });

  it('still navigates with arrows using shared selection logic', () => {
    component.handleKeyboardEvent(key('ArrowDown'));
    expect(component.selectedLocationIndex).toBe(0);
    component.handleKeyboardEvent(key('ArrowUp'));
    expect(component.selectedLocationIndex).toBe(1);
    expect(scrollToSelectedLocation).toHaveBeenCalled();
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

    it('ignores N, L, arrows and Enter while a confirmation is open', () => {
      openDialog('modal-overlay');
      const cancel = document.createElement('button');
      overlay!.appendChild(cancel);
      component.selectedLocationIndex = 0;

      component.handleKeyboardEvent(key('n', { target: cancel }));
      component.handleKeyboardEvent(key('l', { target: cancel }));
      component.handleKeyboardEvent(key('ArrowDown', { target: cancel }));
      component.handleKeyboardEvent(key('ArrowUp', { target: cancel }));
      component.handleKeyboardEvent(key('Enter', { target: document.body }));

      expect(createNewLocation).not.toHaveBeenCalled();
      expect(toggleViewMode).not.toHaveBeenCalled();
      expect(editLocation).not.toHaveBeenCalled();
      expect(scrollToSelectedLocation).not.toHaveBeenCalled();
      expect(component.selectedLocationIndex).toBe(0);
    });

    it('ignores N while the command palette is open, then handles it after close', () => {
      openDialog('command-palette-backdrop');
      component.handleKeyboardEvent(key('n'));
      expect(createNewLocation).not.toHaveBeenCalled();

      overlay!.remove();
      component.handleKeyboardEvent(key('n'));
      expect(createNewLocation).toHaveBeenCalledTimes(1);
    });
  });
});
