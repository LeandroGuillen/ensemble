import { CharacterListComponent } from './character-list.component';
import { Book } from '../../core/interfaces';

describe('Character list current-book quick filter', () => {
  const book: Book = { id: 'a', name: 'Ashes of Vell', code: 'sr2', color: '#e5a855' };
  let component: CharacterListComponent;
  let onBookChange: jasmine.Spy;

  beforeEach(() => {
    component = Object.create(CharacterListComponent.prototype);
    component.selectedBook = '';
    component.currentBook = book;
    onBookChange = spyOn(component, 'onBookChange');
  });

  it('sets the Book filter to the current book and clears it on a second click', () => {
    expect(component.currentBookFilterOn).toBeFalse();

    component.toggleCurrentBookFilter();
    expect(component.selectedBook).toBe('a');
    expect(component.currentBookFilterOn).toBeTrue();

    component.toggleCurrentBookFilter();
    expect(component.selectedBook).toBe('');
    expect(onBookChange).toHaveBeenCalledTimes(2);
  });

  it('replaces another book chosen in the Filters panel', () => {
    component.selectedBook = 'other';
    expect(component.currentBookFilterOn).toBeFalse();
    component.toggleCurrentBookFilter();
    expect(component.selectedBook).toBe('a');
  });

  it('does nothing while no book is pinned', () => {
    component.currentBook = null;
    component.toggleCurrentBookFilter();
    expect(component.selectedBook).toBe('');
    expect(onBookChange).not.toHaveBeenCalled();
    expect(component.currentBookLabel).toBe('');
  });

  it('labels the button with the code, and names the book in full', () => {
    expect(component.currentBookLabel).toBe('sr2');
    expect(component.currentBookName).toBe('sr2 — Ashes of Vell');
  });
});
