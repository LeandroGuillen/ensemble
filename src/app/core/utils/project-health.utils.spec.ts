import { checkProjectHealth, HealthSnapshot } from './project-health.utils';
import { Character } from '../interfaces/character.interface';
import { ProjectMetadata } from '../interfaces/project.interface';

const character = (id: string, changes: Partial<Character> = {}): Character => ({
  id, name: id, category: '', tags: [], books: [], prompts: [], content: '',
  created: new Date(), modified: new Date(), filePath: `/project/${id}.md`, relativePath: `${id}/${id}.md`, ...changes,
});
const snapshot = (): HealthSnapshot => ({
  metadata: { books: [], pinboards: [], settings: { defaultCharacterStyle: 'ink' } } as unknown as ProjectMetadata,
  characters: [], drafts: [], locations: [], houses: [], casts: [], boards: [], documents: [],
});

describe('Project health checks', () => {
  it('finds missing and ambiguous prose links, respects alias fallback, code and drafts', () => {
    const data = snapshot();
    data.characters = [character('one', { aliases: ['First'], content: '[[First]] [[Ghost]] [[Twin]] `[[Code]]` ![[image]]' }),
      character('two', { name: 'Twin' }), character('three', { name: 'Twin' })];
    data.drafts = [character('draft', { name: 'one', draft: true })];
    const links = checkProjectHealth(data).filter(item => item.group === 'Wiki links');
    expect(links.map(item => item.message)).toEqual(['Unresolved link: Ghost', 'Ambiguous link: Twin']);
    expect(links.every(item => item.route.join('/') === '/character/one')).toBeTrue();
  });

  it('reports name/name, alias/alias and alias/name collisions on each source record', () => {
    const data = snapshot();
    data.characters = [character('a', { name: 'Mara', aliases: ['Grey', 'Mara'] }),
      character('b', { name: ' mara ', aliases: ['grey'] }), character('c', { name: 'Grey' })];
    const duplicates = checkProjectHealth(data).filter(item => item.group === 'Duplicate names and aliases');
    expect(duplicates.length).toBe(5);
    expect(new Set(duplicates.map(item => item.route[1]))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('detects orphaned references in Houses, casts, pinboards, threads and book PoVs', () => {
    const data = snapshot();
    data.characters = [character('alive', { thumbnails: { ink: '[[portrait.png]]' } })];
    data.casts = [{ id: 'cast', name: 'Cast', characterIds: ['alive', 'gone'], pinboardId: 'board' }];
    data.houses = [{ id: 'house', name: 'House', relativePath: 'house.md', content: '', motto: '',
      characterIds: ['gone'], leadership: [{ id: 'reign', characterIds: ['alive', 'gone'], notes: '', books: [] }], seatId: 'lost' } as any];
    data.metadata.books = [{ id: 'book', name: 'Book', color: '', povCharacterIds: ['gone'] }];
    data.metadata.pinboards = [{ id: 'board', name: 'Board', nodes: [{ id: 'alive' } as any, { id: 'gone' } as any],
      edges: [{ id: 'edge', source: 'alive', target: 'gone' } as any] }];
    data.boards = [{ path: 'story.pinboard.md', board: { threads: [{ id: 't', name: 'Thread', characters: ['gone'] }], rows: [], cells: {}, cellMeta: {} } }];
    const findings = checkProjectHealth(data).filter(item => item.group === 'Orphaned IDs');
    expect(findings.length).toBe(8);
    expect(findings.every(item => item.route.length > 1 && !!item.fix)).toBeTrue();
    expect(JSON.stringify(data)).toContain('gone');
  });

  it('links unowned pinboards directly and leaves a sole missing House head for manual replacement', () => {
    const data = snapshot();
    data.houses = [{ id: 'house', name: 'House', relativePath: 'house.md', content: '',
      characterIds: [], leadership: [{ id: 'reign', characterIds: ['gone'], notes: 'History', books: [] }] } as any];
    data.metadata.pinboards = [{ id: 'unowned', name: 'Board', nodes: [{ id: 'gone' } as any], edges: [] }];
    const findings = checkProjectHealth(data).filter(item => item.group === 'Orphaned IDs');
    expect(findings[0].route).toEqual(['/house', 'house']);
    expect(findings[0].fix).toBeUndefined();
    expect(findings[0].message).toContain('replacement head');
    expect(findings[1].route).toEqual(['/project-health', 'pinboard', 'unowned']);
    expect(findings[1].fix).toBeDefined();
  });

  it('checks the selected portrait style without falling back to another style', () => {
    const data = snapshot();
    data.characters = [character('a', { thumbnails: { default: 'x.png' } }), character('b', { thumbnails: { ink: 'x.png' } })];
    expect(checkProjectHealth(data).filter(item => item.group === 'Missing portraits').map(item => item.route[1])).toEqual(['a']);
  });

  it('checks 1,000 synthetic records in under 2 seconds without changing them', () => {
    const data = snapshot();
    data.characters = Array.from({ length: 1000 }, (_, i) => character(`person${i}`, {
      aliases: [`Alias ${i}`], content: `History. [[person${(i + 1) % 1000}]] [[Alias ${i}]] [[missing]]`,
    }));
    const before = JSON.stringify(data);
    const start = performance.now();
    const findings = checkProjectHealth(data);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(findings.length).toBe(2000);
    expect(JSON.stringify(data)).toBe(before);
  });
});
