import {
  buildCharacterIdRemap,
  isLegacyCharacterPathId,
  normalizeCharacterRelativePath,
  remapCharacterId,
  remapCharacterRoute,
  remapPlotBoardCharacterIds,
  remapProjectCharacterIds,
} from './character-id.utils';
import { ProjectMetadata } from '../interfaces/project.interface';
import { PlotBoard } from '../interfaces/plot-board.interface';

describe('character-id.utils', () => {
  describe('isLegacyCharacterPathId', () => {
    it('matches root and nested character files', () => {
      expect(isLegacyCharacterPathId('_dessir.md')).toBe(true);
      expect(isLegacyCharacterPathId('main-character/_dessir.md')).toBe(true);
      expect(isLegacyCharacterPathId('main-character\\_dessir.md')).toBe(true);
    });

    it('rejects stable ids', () => {
      expect(isLegacyCharacterPathId('m0k3r5abc123')).toBe(false);
      expect(isLegacyCharacterPathId('dessir')).toBe(false);
    });
  });

  describe('buildCharacterIdRemap', () => {
    it('maps relative paths and unique basenames onto stable ids', () => {
      const idMap = buildCharacterIdRemap([
        { id: 'id-a', relativePath: 'main-character/_alice.md' },
        { id: 'id-b', relativePath: '_bob.md' },
      ]);

      expect(idMap.get('main-character/_alice.md')).toBe('id-a');
      expect(idMap.get('_alice.md')).toBe('id-a');
      expect(idMap.get('_bob.md')).toBe('id-b');
    });

    it('does not map an ambiguous basename', () => {
      const idMap = buildCharacterIdRemap([
        { id: 'id-a', relativePath: 'main/_alice.md' },
        { id: 'id-b', relativePath: 'side/_alice.md' },
      ]);

      expect(idMap.get('_alice.md')).toBeUndefined();
      expect(idMap.get('main/_alice.md')).toBe('id-a');
      expect(idMap.get('side/_alice.md')).toBe('id-b');
    });
  });

  describe('remapCharacterRoute', () => {
    it('rewrites encoded and plain character routes', () => {
      const lookup = (id: string) => (id === 'main/_a.md' ? 'stable' : undefined);

      expect(remapCharacterRoute('/character/main%2F_a.md', lookup)).toBe('/character/stable');
      expect(remapCharacterRoute('/character/main/_a.md?x=1', lookup)).toBe('/character/stable?x=1');
      expect(remapCharacterRoute('/characters', lookup)).toBe('/characters');
    });
  });

  describe('remapProjectCharacterIds', () => {
    it('rewrites casts, book PoVs, pinboard nodes/edges, and lastRoute', () => {
      const metadata: ProjectMetadata = {
        projectName: 'Test',
        version: '1.0.0',
        categories: [],
        tags: [],
        casts: [{ id: 'cast-1', name: 'Main', characterIds: ['_alice.md', 'keep'] }],
        books: [{ id: 'book-1', name: 'Book', color: '#000', povCharacterIds: ['_alice.md'] }],
        settings: { defaultCategory: 'main' },
        pinboards: [
          {
            id: 'pb-1',
            name: 'Default',
            nodes: [{ id: '_alice.md', name: 'Alice', position: { x: 0, y: 0 } }],
            edges: [{ id: 'e1', source: '_alice.md', target: 'keep', type: 'knows', label: '', color: '#fff' }],
          },
        ],
        lastSession: { lastRoute: '/character/_alice.md' },
      };
      const idMap = new Map([['_alice.md', 'id-a']]);

      expect(remapProjectCharacterIds(metadata, idMap)).toBe(true);
      expect(metadata.casts[0].characterIds).toEqual(['id-a', 'keep']);
      expect(metadata.books[0].povCharacterIds).toEqual(['id-a']);
      expect(metadata.pinboards?.[0].nodes[0].id).toBe('id-a');
      expect(metadata.pinboards?.[0].edges[0].source).toBe('id-a');
      expect(metadata.lastSession?.lastRoute).toBe('/character/id-a');
    });

    it('returns false when nothing matches', () => {
      const metadata: ProjectMetadata = {
        projectName: 'Test',
        version: '1.0.0',
        categories: [],
        tags: [],
        casts: [{ id: 'cast-1', name: 'Main', characterIds: ['already-stable'] }],
        books: [],
        settings: { defaultCategory: 'main' },
      };

      expect(remapProjectCharacterIds(metadata, new Map([['_alice.md', 'id-a']]))).toBe(false);
    });
  });

  describe('remapPlotBoardCharacterIds', () => {
    it('rewrites thread character lists', () => {
      const board: PlotBoard = {
        threads: [{ id: 't1', name: 'A', characters: ['_alice.md', 'keep'] }],
        rows: [],
        cells: {},
        cellMeta: {},
      };

      expect(remapPlotBoardCharacterIds(board, new Map([['_alice.md', 'id-a']]))).toBe(true);
      expect(board.threads[0].characters).toEqual(['id-a', 'keep']);
    });
  });

  describe('remapCharacterId / normalize', () => {
    it('normalizes slashes before lookup', () => {
      expect(normalizeCharacterRelativePath('\\foo\\_a.md')).toBe('foo/_a.md');
      expect(remapCharacterId('foo\\_a.md', new Map([['foo/_a.md', 'id-a']]))).toBe('id-a');
    });
  });
});
