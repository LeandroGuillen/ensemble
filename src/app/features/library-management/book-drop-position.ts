/** A book's on-screen box on a shelf, in shelf order (the dragged book left out). */
export interface SlotRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Where a dragged book lands on a shelf: the index to insert at (0..rects.length),
 * from the cursor position.
 *
 * - `grid` (gallery shelves, which wrap): within the row under the cursor, before
 *   the first book whose centre is right of the cursor, else after that row's last
 *   book. Above the first row inserts first; below the last row inserts last.
 * - `list`: before the first row whose centre is below the cursor, else last.
 */
export function insertionIndexAt(rects: SlotRect[], x: number, y: number, layout: 'grid' | 'list'): number {
  if (layout === 'list') {
    const index = rects.findIndex((r) => y < (r.top + r.bottom) / 2);
    return index === -1 ? rects.length : index;
  }
  if (rects.length === 0) return 0;
  if (y < rects[0].top) return 0;
  // Rows are runs of books sharing a vertical band; pick the one under the cursor,
  // or the nearest one above it (a drop in the gap below a row counts as that row).
  let rowStart = -1;
  for (let i = 0; i < rects.length; i++) {
    const newRow = i === 0 || rects[i].top >= rects[i - 1].bottom;
    if (newRow) {
      if (rects[i].top > y) break;
      rowStart = i;
    }
  }
  if (rowStart === -1) return 0;
  let rowEnd = rowStart;
  while (rowEnd + 1 < rects.length && rects[rowEnd + 1].top < rects[rowEnd].bottom) rowEnd++;
  if (y > rects[rowEnd].bottom && rowEnd === rects.length - 1) return rects.length;
  for (let i = rowStart; i <= rowEnd; i++) {
    if (x < (rects[i].left + rects[i].right) / 2) return i;
  }
  return rowEnd + 1;
}
