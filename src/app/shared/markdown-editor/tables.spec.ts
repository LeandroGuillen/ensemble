import { Text } from '@codemirror/state';
import { findTables, renderCell, splitTableRow } from './tables';

describe('markdown tables', () => {
  it('splits rows, with optional outer pipes and escaped pipes', () => {
    expect(splitTableRow('|  | Estrellanzas | Pav |')).toEqual(['', 'Estrellanzas', 'Pav']);
    expect(splitTableRow('a | b \\| c')).toEqual(['a', 'b | c']);
  });

  it('finds tables with alignment and body rows', () => {
    const doc = Text.of([
      '## 2090 - Ganar tiempo (R)',
      '| | Estrellanzas | Pav |',
      '| --- | :---: | ---: |',
      '| Algo roto | Jarrón | Carruaje |',
      '| Presión | Sí | Sí |',
      '- La noche siguiente',
    ]);
    const [table] = findTables(doc);
    expect(table.header).toEqual(['', 'Estrellanzas', 'Pav']);
    expect(table.align).toEqual([null, 'center', 'right']);
    expect(table.rows).toEqual([['Algo roto', 'Jarrón', 'Carruaje'], ['Presión', 'Sí', 'Sí']]);
    expect(doc.sliceString(table.from, table.to).split('\n').length).toBe(4);
  });

  it('ignores pipes without a delimiter row and tables inside code fences', () => {
    expect(findTables(Text.of(['a | b', 'c | d']))).toEqual([]);
    expect(findTables(Text.of(['```', '| a |', '| - |', '```']))).toEqual([]);
  });

  it('renders simple inline Markdown in cells, escaping HTML', () => {
    expect(renderCell('**Sí** <x> [[Reúl Bardez|Reúl]]')).toBe('<strong>Sí</strong> &lt;x&gt; Reúl');
  });
});
