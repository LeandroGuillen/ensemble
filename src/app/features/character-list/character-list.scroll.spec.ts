import { CharacterListComponent } from './character-list.component';
import { CharacterListScrollService } from './views/character-list-scroll.service';

describe('Character list progressive scroll', () => {
  let component: any;
  let el: HTMLDivElement;
  beforeEach(() => {
    component = Object.create(CharacterListComponent.prototype);
    el = document.createElement('div');
    Object.assign(component, {
      scrollableContentRef: { nativeElement: el }, scrollState: new CharacterListScrollService(),
      currentProject: { path: '/throwaway' }, collection: 'characters',
      pendingNavScroll: -1, restoringScroll: null,
    });
  });

  it('restores a return position as the list grows and lets the user cancel it', () => {
    let top = 0;
    let maximum = 0;
    Object.defineProperty(el, 'scrollTop', { get: () => top, set: value => top = Math.min(value, maximum) });
    component.scrollState.positions.set(component.scrollStateKey(), 1200);
    component.ngAfterViewInit();
    expect(top).toBe(0);
    maximum = 600;
    component.restoreScroll();
    expect(top).toBe(600);
    expect(component.restoringScroll).toBe(1200);
    maximum = 1600;
    component.restoreScroll();
    expect(top).toBe(1200);
    expect(component.restoringScroll).toBeNull();
    component.restoringScroll = 1500;
    component.cancelScrollRestore();
    component.restoreScroll();
    expect(top).toBe(1200);
  });

  it('isolates positions by project, collection, grouping and filters', () => {
    const key = component.scrollStateKey();
    for (const [property, value] of [['collection', 'drawer'], ['groupBy', 'tag'], ['searchTerm', 'Mara']]) {
      const previous = component[property];
      component[property] = value;
      expect(component.scrollStateKey()).not.toBe(key);
      component[property] = previous;
    }
    component.currentProject = { path: '/another-throwaway' };
    expect(component.scrollStateKey()).not.toBe(key);
  });

  it('waits for the exact grouped keyboard occurrence to be rendered', () => {
    component.pendingNavScroll = 2001;
    component.scrollPendingSelection();
    expect(component.pendingNavScroll).toBe(2001);
    const card = document.createElement('div');
    card.className = 'character-item';
    card.dataset['navIndex'] = '2001';
    card.scrollIntoView = jasmine.createSpy();
    el.append(card);
    component.scrollPendingSelection();
    expect(card.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
    expect(component.pendingNavScroll).toBe(-1);
  });
});
