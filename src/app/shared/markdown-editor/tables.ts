import { EditorState, Range, StateField, Text } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';

/** A GFM table: header row, delimiter row, body rows. Positions cover whole lines. */
export interface TableBlock {
  from: number;
  to: number;
  header: string[];
  align: Array<'left' | 'center' | 'right' | null>;
  rows: string[][];
}

const DELIMITER_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Split a table row into cells (outer pipes optional, `\|` escapes a pipe). */
export function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function alignment(cell: string): TableBlock['align'][number] {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

/** Find tables line by line (outside code fences); independent of the incremental syntax tree. */
export function findTables(doc: Text): TableBlock[] {
  const tables: TableBlock[] = [];
  let inFence = false;
  for (let n = 1; n < doc.lines; n++) {
    const line = doc.line(n);
    if (FENCE.test(line.text)) inFence = !inFence;
    if (inFence || !line.text.includes('|')) continue;
    const delimiter = doc.line(n + 1);
    if (!DELIMITER_ROW.test(delimiter.text) || !delimiter.text.includes('-')) continue;
    const header = splitTableRow(line.text);
    const align = splitTableRow(delimiter.text).map(alignment);
    if (align.length !== header.length) continue;

    const rows: string[][] = [];
    let last = delimiter;
    for (let m = n + 2; m <= doc.lines; m++) {
      const row = doc.line(m);
      if (!row.text.trim() || !row.text.includes('|')) break;
      rows.push(splitTableRow(row.text));
      last = row;
    }
    tables.push({ from: line.from, to: last.to, header, align, rows });
    n = last.number;
  }
  return tables;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

/** Minimal inline Markdown for cells: bold, italics, code, wikilinks (label only). */
export function renderCell(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1');
}

class TableWidget extends WidgetType {
  constructor(readonly table: TableBlock) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return JSON.stringify(other.table) === JSON.stringify(this.table);
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table-wrap';
    const table = document.createElement('table');
    table.className = 'cm-md-table';
    const columns = this.table.header.length;
    const row = (cells: string[], tag: 'th' | 'td') => {
      const tr = document.createElement('tr');
      for (let i = 0; i < columns; i++) {
        const cell = document.createElement(tag);
        cell.innerHTML = renderCell(cells[i] ?? '');
        const align = this.table.align[i];
        if (align) cell.style.textAlign = align;
        tr.appendChild(cell);
      }
      return tr;
    };
    const thead = document.createElement('thead');
    thead.appendChild(row(this.table.header, 'th'));
    const tbody = document.createElement('tbody');
    for (const cells of this.table.rows) tbody.appendChild(row(cells, 'td'));
    table.append(thead, tbody);
    wrap.appendChild(table);
    // Clicking the table edits its source.
    wrap.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.table.from } });
      view.focus();
    });
    return wrap;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(state: EditorState, tables: TableBlock[]): DecorationSet {
  const out: Range<Decoration>[] = [];
  for (const table of tables) {
    // A table touched by the selection shows its Markdown source for editing.
    const editing = state.selection.ranges.some((range) => range.from <= table.to && range.to >= table.from);
    if (!editing) {
      out.push(Decoration.replace({ block: true, widget: new TableWidget(table) }).range(table.from, table.to));
    }
  }
  return Decoration.set(out);
}

/** Renders GFM tables as HTML tables; the source shows while the cursor is inside one. */
export function markdownTables() {
  return StateField.define<{ tables: TableBlock[]; deco: DecorationSet }>({
    create(state) {
      const tables = findTables(state.doc);
      return { tables, deco: buildDecorations(state, tables) };
    },
    update(value, tr) {
      if (!tr.docChanged && !tr.selection) return value;
      const tables = tr.docChanged ? findTables(tr.state.doc) : value.tables;
      return { tables, deco: buildDecorations(tr.state, tables) };
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.deco),
  });
}
