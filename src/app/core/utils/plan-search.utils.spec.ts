import { parseBookPlan } from './book-plan.utils';
import { foldForSearch, searchPlan } from './plan-search.utils';

const PLAN = [
  '# Fase 4: El precio',                                   // 0
  '## 2180 - Paseo por Nueva Alascar (D)',                 // 1
  'PoV: dessir Dessir Galsea',                             // 2
  '### 3. El Balneario de Selmo',                          // 3
  '- Valedín besa el velo. Ceyda se quita el velo.',       // 4
  '- RE-LECTURA: esconde sus pies blancos.',               // 5
  '## 2185 - Él está aquí (V)',                            // 6
  'PoV: valedin Valedín Tundal',                           // 7
  '- TODO — poder de Ceyda: ¿qué autoridad tiene?',        // 8
  '- Información oculta aquí:',                            // 9
  '\t- La Pestaña del Rey',                                // 10
  '## 2190 - El Balneario (D o R)',                        // 11
  '- Reúl reconoce a MdH.',                                // 12
].join('\n');

const characters = [
  { id: 'ceyda', name: 'Ceyda Ojo', aliases: ['La Pestaña del Rey'] },
  { id: 'reul', name: 'Reúl Bardez' },
];

describe('searchPlan', () => {
  const plan = parseBookPlan(PLAN);
  const lines = (query: string) => searchPlan(plan, query, characters).flatMap((g) => g.items.map((i) => i.line));

  it('lists chapters for an empty query or chapter codes', () => {
    expect(lines('')).toEqual([1, 6, 11]);
    expect(lines('218')).toEqual([1, 6]);
    expect(searchPlan(plan, '2185', characters)[0]).toEqual(
      jasmine.objectContaining({ title: 'Él está aquí', code: '2185', pov: [jasmine.objectContaining({ characterId: 'valedin', name: 'Valedín Tundal' })] })
    );
  });

  it('matches words in lines and headings, ignoring case and accents', () => {
    expect(lines('balneario')).toEqual([3, 11]);
    expect(lines('reul')).toEqual([12]);
    expect(lines('velo ceyda')).toEqual([4]);
  });

  it('filters by marker, with prefixes', () => {
    expect(lines('!todo')).toEqual([8]);
    expect(lines('!oc')).toEqual([9, 10]);
    expect(lines('!rel pies')).toEqual([5]);
    expect(lines('!nope')).toEqual([]);
  });

  it('finds character mentions by first name or alias', () => {
    expect(lines('@ceyda')).toEqual([4, 8, 10]);
    expect(lines('@ceyda !todo')).toEqual([8]);
    expect(lines('@reú')).toEqual([12]);
    expect(lines('@mdh')).toEqual([12]);
  });

  it('limits results to chapters when a code is combined with other terms', () => {
    expect(lines('2185 @ceyda')).toEqual([8, 10]);
  });

  it('groups by chapter and highlights matches', () => {
    const groups = searchPlan(plan, 'velo', characters);
    expect(groups.length).toBe(1);
    expect(groups[0].code).toBe('2180');
    const item = groups[0].items[0];
    expect(item.highlights.map(([from, to]) => item.text.slice(from, to))).toEqual(['velo', 'velo']);
  });
});

describe('foldForSearch', () => {
  it('keeps the original length', () => {
    const text = 'Él está aquí, Reúl';
    expect(foldForSearch(text)).toBe('el esta aqui, reul');
    expect(foldForSearch(text).length).toBe(text.length);
  });
});
