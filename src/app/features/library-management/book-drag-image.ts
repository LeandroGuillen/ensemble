import { Book } from '../../core/interfaces/project.interface';
import { getBookCoverTitle } from '../../core/utils/book-display.utils';

const WIDTH = 46;
const HEIGHT = 64;

/**
 * Builds a small book cover (the book's color and code) to follow the cursor
 * while a book is dragged from the Books page. The element is added off-screen
 * because the browser snapshots it when the drag starts; the caller removes it
 * right after (`setDragImage` has already copied it by then).
 */
export function createBookDragImage(book: Pick<Book, 'name' | 'code' | 'color'>, doc: Document = document): HTMLElement {
  const color = book.color || '#3498db';
  const el = doc.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.className = 'book-drag-image';
  Object.assign(el.style, {
    position: 'fixed',
    top: '-1000px',
    left: '-1000px',
    width: `${WIDTH}px`,
    height: `${HEIGHT}px`,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 4px 4px 9px',
    borderRadius: '2px 5px 5px 2px',
    background: `linear-gradient(135deg, color-mix(in srgb, ${color} 70%, #000) 0%, ${color} 100%)`,
    boxShadow: 'inset 5px 0 0 rgba(0, 0, 0, 0.3), inset -1px 0 0 rgba(255, 255, 255, 0.15), 0 6px 16px rgba(0, 0, 0, 0.45)',
    color: '#fff',
    font: '700 11px/1.1 system-ui, sans-serif',
    textAlign: 'center',
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
    overflow: 'hidden',
    wordBreak: 'break-word',
    pointerEvents: 'none',
    zIndex: '-1',
  } satisfies Partial<CSSStyleDeclaration>);
  el.textContent = getBookCoverTitle(book).slice(0, 18);
  return el;
}

/** Uses a small book cover as the drag image; the cursor holds it near its lower-left corner. */
export function setBookDragImage(dataTransfer: DataTransfer, book: Pick<Book, 'name' | 'code' | 'color'>, doc: Document = document): void {
  const el = createBookDragImage(book, doc);
  doc.body.appendChild(el);
  dataTransfer.setDragImage(el, 12, HEIGHT - 12);
  setTimeout(() => el.remove(), 0);
}
