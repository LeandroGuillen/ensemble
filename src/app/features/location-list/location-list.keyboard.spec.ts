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
});
