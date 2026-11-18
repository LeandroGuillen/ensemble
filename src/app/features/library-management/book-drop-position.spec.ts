import { SlotRect, insertionIndexAt } from './book-drop-position';

const box = (left: number, top: number, w = 100, h = 150): SlotRect => ({ left, right: left + w, top, bottom: top + h });

describe('insertionIndexAt', () => {
  // Two rows: three books, then two.
  const grid = [box(0, 0), box(110, 0), box(220, 0), box(0, 170), box(110, 170)];

  it('inserts before the book whose centre is right of the cursor', () => {
    expect(insertionIndexAt(grid, 10, 50, 'grid')).toBe(0);
    expect(insertionIndexAt(grid, 60, 50, 'grid')).toBe(1);
    expect(insertionIndexAt(grid, 105, 50, 'grid')).toBe(1); // gap between books
    expect(insertionIndexAt(grid, 300, 50, 'grid')).toBe(3); // right of the first row
    expect(insertionIndexAt(grid, 500, 50, 'grid')).toBe(3);
  });

  it('uses the row under the cursor on wrapped shelves', () => {
    expect(insertionIndexAt(grid, 10, 200, 'grid')).toBe(3);
    expect(insertionIndexAt(grid, 180, 200, 'grid')).toBe(5);
    expect(insertionIndexAt(grid, 10, 160, 'grid')).toBe(0); // gap below a row: that row, by x
    expect(insertionIndexAt(grid, 400, 160, 'grid')).toBe(3);
    expect(insertionIndexAt(grid, 10, 900, 'grid')).toBe(5); // below everything
    expect(insertionIndexAt(grid, 10, -20, 'grid')).toBe(0); // above everything
  });

  it('handles empty shelves and list rows', () => {
    expect(insertionIndexAt([], 0, 0, 'grid')).toBe(0);
    const rows = [box(0, 0, 400, 40), box(0, 44, 400, 40), box(0, 88, 400, 40)];
    expect(insertionIndexAt(rows, 0, 10, 'list')).toBe(0);
    expect(insertionIndexAt(rows, 0, 30, 'list')).toBe(1);
    expect(insertionIndexAt(rows, 0, 70, 'list')).toBe(2);
    expect(insertionIndexAt(rows, 0, 500, 'list')).toBe(3);
  });
});
