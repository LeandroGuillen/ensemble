import { createBookDragImage, setBookDragImage } from './book-drag-image';

describe('Book drag image', () => {
  it('shows the book code on its color', () => {
    const el = createBookDragImage({ name: 'Nueva Alascar', code: 'b2', color: '#ff8800' });
    expect(el.textContent).toBe('b2');
    expect(el.style.background).toContain('rgb(255, 136, 0)');
  });

  it('falls back to the title when the book has no code', () => {
    expect(createBookDragImage({ name: 'Lantern Tide', color: '#111111' }).textContent).toBe('Lantern Tide');
  });

  it('hands a cover to the drag and removes it from the page afterwards', () => {
    jasmine.clock().install();
    try {
      const dataTransfer = jasmine.createSpyObj<DataTransfer>('DataTransfer', ['setDragImage']);
      setBookDragImage(dataTransfer, { name: 'Ashes', code: 'sr2', color: '#123456' });
      const [image, x, y] = dataTransfer.setDragImage.calls.mostRecent().args;
      expect(image.isConnected).toBeTrue();
      expect(image.textContent).toBe('sr2');
      expect(x).toBeGreaterThan(0);
      expect(y).toBeGreaterThan(0);
      jasmine.clock().tick(1);
      expect(image.isConnected).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
