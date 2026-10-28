import { HouseListComponent } from './house-list.component';

describe('HouseListComponent keyboard', () => {
  let component: HouseListComponent;
  let createNewHouse: jasmine.Spy;
  let openHouse: jasmine.Spy;
  let scrollToSelectedHouse: jasmine.Spy;
  let markForCheck: jasmine.Spy;

  beforeEach(() => {
    createNewHouse = jasmine.createSpy('createNewHouse');
    openHouse = jasmine.createSpy('openHouse');
    scrollToSelectedHouse = jasmine.createSpy('scrollToSelectedHouse');
    markForCheck = jasmine.createSpy('markForCheck');

    component = Object.create(HouseListComponent.prototype);
    Object.assign(component, {
      records: [
        { id: 'h1', name: 'Stark', motto: '', content: '', characterIds: [], leadership: [], colors: [] },
        { id: 'h2', name: 'Lannister', motto: '', content: '', characterIds: [], leadership: [], colors: [] },
      ],
      search: '',
      selectedHouseIndex: -1,
      createNewHouse,
      openHouse,
      scrollToSelectedHouse,
      cdr: { markForCheck },
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

  it('navigates with arrows and opens with Enter', () => {
    component.handleKeyboardEvent(key('ArrowDown'));
    expect(component.selectedHouseIndex).toBe(0);
    component.handleKeyboardEvent(key('Enter'));
    expect(openHouse).toHaveBeenCalledWith(component.filtered[0]);
  });

  it('creates with N but ignores Ctrl+N and editable focus', () => {
    component.handleKeyboardEvent(key('n', { ctrlKey: true }));
    expect(createNewHouse).not.toHaveBeenCalled();
    component.handleKeyboardEvent(key('n', { target: document.createElement('input') }));
    expect(createNewHouse).not.toHaveBeenCalled();
    component.handleKeyboardEvent(key('n'));
    expect(createNewHouse).toHaveBeenCalled();
  });
});
