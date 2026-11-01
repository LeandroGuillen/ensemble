import { TestBed } from '@angular/core/testing';
import { PlotBoardService } from './plot-board.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';
import { Project } from '../interfaces/project.interface';

describe('PlotBoardService', () => {
  let service: PlotBoardService;
  let electronService: jasmine.SpyObj<ElectronService>;
  let projectService: jasmine.SpyObj<ProjectService>;
  let loggingService: jasmine.SpyObj<LoggingService>;

  const PROJECT_PATH = '/test/project';

  const createTestBoard = (threads: { id: string; name: string; characters: string[] }[]) => {
    return {
      threads: threads.map(t => ({
        id: t.id,
        name: t.name,
        characters: t.characters,
        color: '#000000',
        books: []
      })),
      rows: [],
      cells: {},
      cellMeta: {}
    };
  };

  const generateBoardContent = (board: any): string => {
    // Simplified markdown generation matching the real service
    const frontmatter = {
      threads: board.threads
    };
    return `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n\n| Thread |\n|--------|\n`;
  };

  beforeEach(() => {
    const electronSpy = jasmine.createSpyObj('ElectronService', [
      'readDirectoryRecursive',
      'readFile',
      'writeFileAtomic'
    ]);
    const projectSpy = jasmine.createSpyObj('ProjectService', ['getCurrentProject']);
    const loggingSpy = jasmine.createSpyObj('LoggingService', ['error', 'warn']);

    TestBed.configureTestingModule({
      providers: [
        PlotBoardService,
        { provide: ElectronService, useValue: electronSpy },
        { provide: ProjectService, useValue: projectSpy },
        { provide: LoggingService, useValue: loggingSpy }
      ]
    });

    service = TestBed.inject(PlotBoardService);
    electronService = TestBed.inject(ElectronService) as jasmine.SpyObj<ElectronService>;
    projectService = TestBed.inject(ProjectService) as jasmine.SpyObj<ProjectService>;
    loggingService = TestBed.inject(LoggingService) as jasmine.SpyObj<LoggingService>;

    const project: Project = {
      path: PROJECT_PATH,
      metadata: { 
        projectName: 'Test Project',
        version: '1.0.0',
        categories: [], 
        tags: [], 
        books: [], 
        settings: {
          defaultCategory: 'main-character',
          characterStyles: [{ id: 'default', name: 'Default' }],
          defaultCharacterStyle: 'default'
        }, 
        pinboards: [] 
      }
    };
    projectService.getCurrentProject.and.returnValue(project);
  });

  describe('countCharacterReferences', () => {
    it('should return only boards containing the character', async () => {
      // Two board files: one with char-1, one without
      const board1Content = generateBoardContent(
        createTestBoard([
          { id: 't1', name: 'Thread 1', characters: ['char-1', 'char-2'] },
          { id: 't2', name: 'Thread 2', characters: ['char-3'] }
        ])
      );
      const board2Content = generateBoardContent(
        createTestBoard([
          { id: 't3', name: 'Thread 3', characters: ['char-3', 'char-4'] }
        ])
      );

      electronService.readDirectoryRecursive.and.returnValues(
        Promise.resolve({ 
          success: true, 
          files: [
            { relativePath: 'arc1.plotboard.md', absolutePath: `${PROJECT_PATH}/arc1.plotboard.md` },
            { relativePath: 'arc2.plotboard.md', absolutePath: `${PROJECT_PATH}/arc2.plotboard.md` }
          ] 
        }),
        Promise.resolve({ success: true, files: [] })
      );

      electronService.readFile.and.callFake((path: string) => {
        if (path.includes('arc1.plotboard.md')) {
          return Promise.resolve({ success: true, content: board1Content });
        }
        if (path.includes('arc2.plotboard.md')) {
          return Promise.resolve({ success: true, content: board2Content });
        }
        return Promise.resolve({ success: false });
      });

      const result = await service.countCharacterReferences('char-1');

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('arc1.plotboard.md');
      expect(result[0].name).toBe('arc1');
    });

    it('should return empty array when character is not in any board', async () => {
      const boardContent = generateBoardContent(
        createTestBoard([
          { id: 't1', name: 'Thread 1', characters: ['char-2', 'char-3'] }
        ])
      );

      electronService.readDirectoryRecursive.and.returnValues(
        Promise.resolve({ 
          success: true, 
          files: [{ relativePath: 'board.plotboard.md', absolutePath: `${PROJECT_PATH}/board.plotboard.md` }] 
        }),
        Promise.resolve({ success: true, files: [] })
      );

      electronService.readFile.and.returnValue(
        Promise.resolve({ success: true, content: boardContent })
      );

      const result = await service.countCharacterReferences('char-1');

      expect(result.length).toBe(0);
    });
  });

  describe('removeCharacterFromThreads', () => {
    it('should remove character from affected boards only', async () => {
      const board1 = createTestBoard([
        { id: 't1', name: 'Thread 1', characters: ['char-1', 'char-2'] },
        { id: 't2', name: 'Thread 2', characters: ['char-3'] }
      ]);
      const board2 = createTestBoard([
        { id: 't3', name: 'Thread 3', characters: ['char-3', 'char-4'] }
      ]);

      const board1Content = generateBoardContent(board1);
      const board2Content = generateBoardContent(board2);

      electronService.readDirectoryRecursive.and.returnValues(
        Promise.resolve({ 
          success: true, 
          files: [
            { relativePath: 'arc1.plotboard.md', absolutePath: `${PROJECT_PATH}/arc1.plotboard.md` },
            { relativePath: 'arc2.plotboard.md', absolutePath: `${PROJECT_PATH}/arc2.plotboard.md` }
          ] 
        }),
        Promise.resolve({ success: true, files: [] })
      );

      electronService.readFile.and.callFake((path: string) => {
        if (path.includes('arc1.plotboard.md')) {
          return Promise.resolve({ success: true, content: board1Content });
        }
        if (path.includes('arc2.plotboard.md')) {
          return Promise.resolve({ success: true, content: board2Content });
        }
        return Promise.resolve({ success: false });
      });

      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      await service.removeCharacterFromThreads('char-1');

      // Should write only the affected board (arc1)
      expect(electronService.writeFileAtomic).toHaveBeenCalledTimes(1);
      const writeCall = electronService.writeFileAtomic.calls.first();
      expect(writeCall.args[0]).toContain('arc1.plotboard.md');

      // Verify the written content has char-1 removed but char-2 remains
      const writtenContent = writeCall.args[1];
      expect(writtenContent).toContain('char-2');
      expect(writtenContent).not.toContain('char-1');
      expect(writtenContent).toContain('Thread 1'); // Thread metadata intact
    });

    it('should handle write failures gracefully and continue processing other boards', async () => {
      const board1 = createTestBoard([
        { id: 't1', name: 'Thread 1', characters: ['char-1', 'char-2'] }
      ]);
      const board2 = createTestBoard([
        { id: 't2', name: 'Thread 2', characters: ['char-1', 'char-3'] }
      ]);

      const board1Content = generateBoardContent(board1);
      const board2Content = generateBoardContent(board2);

      electronService.readDirectoryRecursive.and.returnValues(
        Promise.resolve({ 
          success: true, 
          files: [
            { relativePath: 'board1.plotboard.md', absolutePath: `${PROJECT_PATH}/board1.plotboard.md` },
            { relativePath: 'board2.plotboard.md', absolutePath: `${PROJECT_PATH}/board2.plotboard.md` }
          ] 
        }),
        Promise.resolve({ success: true, files: [] })
      );

      electronService.readFile.and.callFake((path: string) => {
        if (path.includes('board1.plotboard.md')) {
          return Promise.resolve({ success: true, content: board1Content });
        }
        if (path.includes('board2.plotboard.md')) {
          return Promise.resolve({ success: true, content: board2Content });
        }
        return Promise.resolve({ success: false });
      });

      // First write fails, second succeeds
      electronService.writeFileAtomic.and.returnValues(
        Promise.resolve({ success: false, error: 'Write error' }),
        Promise.resolve({ success: true })
      );

      // Should not throw
      await service.removeCharacterFromThreads('char-1');

      // Should have attempted to write both boards
      expect(electronService.writeFileAtomic).toHaveBeenCalledTimes(2);

      // Should have logged the error for the first board
      expect(loggingService.error).toHaveBeenCalledWith(
        jasmine.stringContaining('board1.plotboard.md'),
        jasmine.any(String)
      );

      // Verify both boards were processed despite first failure
      const calls = electronService.writeFileAtomic.calls.all();
      expect(calls[0].args[0]).toContain('board1.plotboard.md');
      expect(calls[1].args[0]).toContain('board2.plotboard.md');
    });

    it('should preserve other thread data when removing character', async () => {
      const board = createTestBoard([
        { id: 't1', name: 'Important Thread', characters: ['char-1', 'char-2', 'char-3'] },
        { id: 't2', name: 'Another Thread', characters: ['char-4'] }
      ]);
      const boardContent = generateBoardContent(board);

      electronService.readDirectoryRecursive.and.returnValues(
        Promise.resolve({ 
          success: true, 
          files: [{ relativePath: 'test.plotboard.md', absolutePath: `${PROJECT_PATH}/test.plotboard.md` }] 
        }),
        Promise.resolve({ success: true, files: [] })
      );

      electronService.readFile.and.returnValue(
        Promise.resolve({ success: true, content: boardContent })
      );

      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      await service.removeCharacterFromThreads('char-1');

      const writtenContent = electronService.writeFileAtomic.calls.first().args[1];

      // Should remove char-1 but keep char-2 and char-3
      expect(writtenContent).not.toContain('char-1');
      expect(writtenContent).toContain('char-2');
      expect(writtenContent).toContain('char-3');

      // Should preserve thread metadata
      expect(writtenContent).toContain('Important Thread');
      expect(writtenContent).toContain('Another Thread');

      // Both threads should still exist
      const parsed = service.parseFile(writtenContent);
      expect(parsed.threads.length).toBe(2);
      expect(parsed.threads[0].characters).toEqual(['char-2', 'char-3']);
      expect(parsed.threads[1].characters).toEqual(['char-4']);
    });
  });
  describe('table cell escaping round-trip', () => {
    const thread = (id: string, name: string) => ({ id, name, characters: [], color: '#000000', books: [] });

    const roundTrip = (board: any) => service.parseFile(service.generateFile(board));

    const tricky = [
      'Choice: stay | go',
      'back\\slash',
      'literal \\| escaped pipe',
      'trailing backslash \\',
      'double trailing \\\\',
      'line one\nline two',
      '| leading and trailing |',
    ];

    tricky.forEach((value) => {
      it(`keeps cells intact: ${JSON.stringify(value)}`, () => {
        const board = {
          threads: [thread('a', 'A'), thread('b', 'B'), thread('c', 'C')],
          rows: [{ name: 'Ch 1' }],
          cells: { '0': { a: value, b: 'Letter arrives', c: 'third' } },
          cellMeta: {},
        };
        const parsed = roundTrip(board);
        expect(parsed.cells).toEqual(board.cells);
        expect(parsed.rows.map((r) => r.name)).toEqual(['Ch 1']);
      });

      it(`keeps row and thread names intact: ${JSON.stringify(value)}`, () => {
        const board = {
          threads: [thread('a', value), thread('b', 'B')],
          rows: [{ name: value }, { name: 'Ch 2' }],
          cells: { '0': { a: 'x', b: 'y' }, '1': { a: 'z', b: 'w' } },
          cellMeta: {},
        };
        const parsed = roundTrip(board);
        expect(parsed.rows.map((r) => r.name)).toEqual([value, 'Ch 2']);
        expect(parsed.threads.map((t) => t.name)).toEqual([value, 'B']);
        expect(parsed.cells).toEqual(board.cells);
      });
    });

    it('parses existing pipe-free boards exactly as before', () => {
      const raw = [
        '---',
        'threads:',
        '  - id: main',
        '    name: Main',
        '    characters: []',
        '  - id: sub',
        '    name: Sub',
        '    characters: []',
        '---',
        '',
        '|| Main | Sub |',
        '|---|---|---|',
        '| Ch 1 | Ana meets Bo |  |',
        '| Ch 2 |   | Storm<br>hits |',
      ].join('\n');
      const parsed = service.parseFile(raw);
      expect(parsed.rows.map((r) => r.name)).toEqual(['Ch 1', 'Ch 2']);
      expect(parsed.cells).toEqual({ '0': { main: 'Ana meets Bo' }, '1': { sub: 'Storm\nhits' } });
    });
  });
  describe('threads with duplicate names', () => {
    const thread = (id: string, name: string) => ({ id, name, characters: [], color: '#000000', books: [] });

    it('round-trips cells and cellMeta for two threads with the same name', () => {
      const id1 = service.generateThreadId('New Thread', []);
      const id2 = service.generateThreadId('New Thread', [thread(id1, 'New Thread')]);
      expect(id2).not.toBe(id1);
      const board = {
        threads: [thread(id1, 'New Thread'), thread(id2, 'New Thread')],
        rows: [{ name: 'Ch 1' }, { name: 'Ch 2' }],
        cells: { '0': { [id1]: 'Ana meets Bo', [id2]: 'The storm hits' }, '1': { [id2]: 'Bo leaves town' } },
        cellMeta: { '0': { [id2]: { color: '#ff0000' } }, '1': { [id1]: { icon: 'star' } } },
      };
      const parsed = service.parseFile(service.generateFile(board as any));
      expect(parsed.cells).toEqual(board.cells);
      expect(parsed.cellMeta).toEqual(board.cellMeta as any);
    });

    it('handles three threads sharing a name between distinct ones', () => {
      const board = {
        threads: [thread('a', 'X'), thread('b', 'Y'), thread('c', 'X'), thread('d', 'X')],
        rows: [{ name: 'Ch 1' }],
        cells: { '0': { a: '1', b: '2', c: '3', d: '4' } },
        cellMeta: {},
      };
      expect(service.parseFile(service.generateFile(board as any)).cells).toEqual(board.cells);
    });

    it('falls back to name matching when the column order differs from the frontmatter', () => {
      const raw = [
        '---',
        'threads:',
        '  - id: main',
        '    name: Main',
        '    characters: []',
        '  - id: sub',
        '    name: Sub',
        '    characters: []',
        '---',
        '',
        '|| Sub | Main |',
        '|---|---|---|',
        '| Ch 1 | sub text | main text |',
      ].join('\n');
      expect(service.parseFile(raw).cells).toEqual({ '0': { sub: 'sub text', main: 'main text' } });
    });

    it('uniqueThreadName numbers repeated default names', () => {
      expect(service.uniqueThreadName('New Thread', [])).toBe('New Thread');
      expect(service.uniqueThreadName('New Thread', [thread('a', 'New Thread')])).toBe('New Thread 2');
      expect(
        service.uniqueThreadName('New Thread', [thread('a', 'New Thread'), thread('b', 'New Thread 2')])
      ).toBe('New Thread 3');
    });
  });
});

