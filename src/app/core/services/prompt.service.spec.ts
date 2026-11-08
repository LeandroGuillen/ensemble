import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { PromptService, sanitizePromptPath } from './prompt.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { CharacterService } from './character.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { UndoDeleteService } from './undo-delete.service';
import { Character } from '../interfaces/character.interface';
import { parsePromptFile } from '../utils/prompt-file.utils';

describe('sanitizePromptPath', () => {
  it('keeps folders and accents, strips unsafe parts', () => {
    expect(sanitizePromptPath('places/Academia')).toBe('places/Academia');
    expect(sanitizePromptPath(' ../secret/ Madre Galsea.md ')).toBe('secret/Madre Galsea');
    expect(sanitizePromptPath('a\\b:c*?')).toBe('a/bc');
    expect(sanitizePromptPath('.hidden/x')).toBe('hidden/x');
    expect(sanitizePromptPath('folder/')).toBe('folder');
    expect(sanitizePromptPath('  /  ')).toBe('');
  });
});

describe('PromptService', () => {
  const projectPath = '/vault';
  const promptsRoot = '/vault/prompts';
  let files: Map<string, string>;
  let electron: jasmine.SpyObj<ElectronService>;
  let characters$: BehaviorSubject<Character[]>;
  let characterService: jasmine.SpyObj<CharacterService>;
  let service: PromptService;

  const character = (over: Partial<Character>): Character => ({
    id: 'c1',
    name: 'Dessir',
    category: 'main',
    tags: [],
    books: [],
    prompts: [],
    content: '',
    created: new Date(),
    modified: new Date(),
    relativePath: 'dessir/dessir.md',
    filePath: '/vault/characters/dessir/dessir.md',
    ...over,
  });

  beforeEach(() => {
    files = new Map();
    electron = jasmine.createSpyObj<ElectronService>('ElectronService', [
      'fileExists', 'readDirectoryRecursive', 'readFile', 'writeFileAtomic', 'createDirectory',
      'moveFile', 'stageForTrash', 'copyFile', 'getImageAsDataUrl',
    ]);
    electron.fileExists.and.callFake(async (p: string) => p === promptsRoot || files.has(p));
    electron.createDirectory.and.resolveTo({ success: true });
    electron.readDirectoryRecursive.and.callFake(async () => ({
      success: true,
      files: [...files.keys()]
        .filter((p) => p.startsWith(`${promptsRoot}/`))
        .map((absolutePath) => ({ absolutePath, relativePath: absolutePath.slice(promptsRoot.length + 1) })),
    }));
    electron.readFile.and.callFake(async (p: string) =>
      files.has(p) ? { success: true, content: files.get(p)! } : { success: false, error: 'missing' }
    );
    electron.writeFileAtomic.and.callFake(async (p: string, content: string) => {
      files.set(p, content);
      return { success: true };
    });
    electron.moveFile.and.callFake(async (from: string, to: string) => {
      files.set(to, files.get(from)!);
      files.delete(from);
      return { success: true };
    });

    const project = { path: projectPath, metadata: { settings: {} } } as any;
    const projectService = jasmine.createSpyObj<ProjectService>('ProjectService', ['getCurrentProject', 'getPromptsFolderPath'], {
      currentProject$: new BehaviorSubject(project),
    });
    projectService.getCurrentProject.and.returnValue(project);
    projectService.getPromptsFolderPath.and.returnValue(promptsRoot);

    characters$ = new BehaviorSubject<Character[]>([]);
    characterService = jasmine.createSpyObj<CharacterService>('CharacterService', ['clearLegacyPrompts'], {
      characters$: characters$.asObservable(),
      lore$: new BehaviorSubject<Character[]>([]).asObservable(),
      drafts$: new BehaviorSubject<Character[]>([]).asObservable(),
    });
    characterService.clearLegacyPrompts.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        PromptService,
        { provide: ElectronService, useValue: electron },
        { provide: ProjectService, useValue: projectService },
        { provide: CharacterService, useValue: characterService },
        { provide: FileWatcherService, useValue: { fileChanges$: new Subject() } },
        { provide: LoggingService, useValue: jasmine.createSpyObj('LoggingService', ['log', 'warn', 'error']) },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['showSuccess', 'showError', 'showWarning']) },
        { provide: UndoDeleteService, useValue: jasmine.createSpyObj('UndoDeleteService', ['register']) },
      ],
    });
    service = TestBed.inject(PromptService);
  });

  it('scans markdown files with folders and names', async () => {
    files.set(`${promptsRoot}/places/Academia.md`, '```prompt\nhall\n```\n');
    files.set(`${promptsRoot}/llm.md`, 'plain text');
    await service.ensureLoaded();
    const loaded = service.getPromptsSnapshot();
    expect(loaded.map((f) => [f.relativePath, f.name, f.folder])).toEqual([
      ['llm.md', 'llm', ''],
      ['places/Academia.md', 'Academia', 'places'],
    ]);
  });

  it('creates prompts with a free name and links characters on the prompt side', async () => {
    await service.ensureLoaded();
    const first = await service.createPromptForCharacter({ id: 'c1', name: 'Dessir' });
    const second = await service.createPromptForCharacter({ id: 'c1', name: 'Dessir' });
    expect(first.relativePath).toBe('characters/Dessir.md');
    expect(second.relativePath).toBe('characters/Dessir-2.md');
    expect(parsePromptFile(files.get(first.filePath)!).characters).toEqual(['c1']);

    await service.setCharacterLink(second.relativePath, 'c1', false);
    expect(service.promptsForCharacter('c1').map((f) => f.relativePath)).toEqual(['characters/Dessir.md']);
  });

  it('moves prompts between folders', async () => {
    await service.ensureLoaded();
    const file = await service.createPrompt('Academia');
    const moved = await service.movePrompt(file.relativePath, 'places/Academia');
    expect(moved.relativePath).toBe('places/Academia.md');
    expect(files.has(`${promptsRoot}/places/Academia.md`)).toBeTrue();
    expect(files.has(`${promptsRoot}/Academia.md`)).toBeFalse();
  });

  it('moves legacy frontmatter prompts into a linked file and clears them', async () => {
    characters$.next([
      character({
        prompts: [
          { name: '', positive: '1woman, braids', negative: 'child' },
          { name: 'with clothes', positive: '1woman, shirt', negative: '' },
        ],
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve));
    await service.ensureLoaded();
    await new Promise((resolve) => setTimeout(resolve));

    const content = files.get(`${promptsRoot}/characters/Dessir.md`);
    expect(content).toBeDefined();
    const data = parsePromptFile(content!);
    expect(data.characters).toEqual(['c1']);
    expect(data.sections.map((s) => [s.name, s.prompt, s.negative])).toEqual([
      ['', '1woman, braids', 'child'],
      ['with clothes', '1woman, shirt', null],
    ]);
    expect(characterService.clearLegacyPrompts).toHaveBeenCalledWith('c1');
  });

  it('does not duplicate a prompt file when the migration was interrupted', async () => {
    files.set(
      `${promptsRoot}/characters/Dessir.md`,
      '---\ncharacters: [c1]\n---\n```prompt\n1woman, braids\n```\n'
    );
    characters$.next([character({ prompts: [{ name: '', positive: '1woman, braids', negative: '' }] })]);
    await new Promise((resolve) => setTimeout(resolve));
    await service.ensureLoaded();
    await new Promise((resolve) => setTimeout(resolve));

    expect([...files.keys()].filter((p) => p.includes('Dessir'))).toEqual([`${promptsRoot}/characters/Dessir.md`]);
    expect(characterService.clearLegacyPrompts).toHaveBeenCalledWith('c1');
  });

  describe('prompt links of deleted characters and locations', () => {
    const maraPath = `${promptsRoot}/characters/Mara Vell.md`;
    const harborPath = `${promptsRoot}/places/Grey Harbor.md`;

    beforeEach(() => {
      files.set(maraPath, '---\ncharacters:\n  - other\n  - mara-vell\n  - third\n---\n```prompt\nmara\n```\n');
      files.set(harborPath, '---\ncharacters:\n  - mara-vell\nlocations:\n  - harbor\n  - lighthouse\n---\nnotes\n');
      files.set(`${promptsRoot}/unrelated.md`, '---\ncharacters:\n  - other\n---\nx\n');
    });

    it('counts the prompt files that link an id', async () => {
      expect(await service.countLinks('characters', 'mara-vell')).toEqual([
        { id: 'characters/Mara Vell.md', name: 'Mara Vell' },
        { id: 'places/Grey Harbor.md', name: 'Grey Harbor' },
      ]);
      expect(await service.countLinks('locations', 'harbor')).toEqual([
        { id: 'places/Grey Harbor.md', name: 'Grey Harbor' },
      ]);
    });

    it('unlinks a character from every prompt file and Undo puts it back in place', async () => {
      const unrelatedBefore = files.get(`${promptsRoot}/unrelated.md`);
      const snapshot = await service.removeLinks('characters', 'mara-vell');

      expect(snapshot.removals).toEqual([
        { relativePath: 'characters/Mara Vell.md', promptName: 'Mara Vell', index: 1 },
        { relativePath: 'places/Grey Harbor.md', promptName: 'Grey Harbor', index: 0 },
      ]);
      expect(parsePromptFile(files.get(maraPath)!).characters).toEqual(['other', 'third']);
      expect(parsePromptFile(files.get(harborPath)!).characters).toEqual([]);
      expect(parsePromptFile(files.get(harborPath)!).locations).toEqual(['harbor', 'lighthouse']);
      expect(service.promptsForCharacter('mara-vell')).toEqual([]);
      expect(files.get(`${promptsRoot}/unrelated.md`)).toBe(unrelatedBefore);

      const result = await service.restoreLinks(snapshot);

      expect(result).toEqual({ restored: 2, skipped: [] });
      expect(parsePromptFile(files.get(maraPath)!).characters).toEqual(['other', 'mara-vell', 'third']);
      expect(parsePromptFile(files.get(harborPath)!).characters).toEqual(['mara-vell']);
      expect(service.promptsForCharacter('mara-vell').map((f) => f.relativePath)).toEqual([
        'characters/Mara Vell.md',
        'places/Grey Harbor.md',
      ]);
    });

    it('unlinks a location and restores it at its old position', async () => {
      const snapshot = await service.removeLinks('locations', 'harbor');
      expect(parsePromptFile(files.get(harborPath)!).locations).toEqual(['lighthouse']);
      expect(parsePromptFile(files.get(harborPath)!).characters).toEqual(['mara-vell']);

      await service.restoreLinks(snapshot);
      expect(parsePromptFile(files.get(harborPath)!).locations).toEqual(['harbor', 'lighthouse']);
    });

    it('reports a prompt deleted before Undo as skipped', async () => {
      const snapshot = await service.removeLinks('characters', 'mara-vell');
      files.delete(harborPath);
      await service.forceReload();

      const result = await service.restoreLinks(snapshot);

      expect(result.restored).toBe(1);
      expect(result.skipped).toEqual([{ kind: 'prompt', id: 'places/Grey Harbor.md', label: 'Grey Harbor' }]);
      expect(parsePromptFile(files.get(maraPath)!).characters).toEqual(['other', 'mara-vell', 'third']);
    });

    it('keeps the link and warns when a prompt file cannot be written', async () => {
      electron.writeFileAtomic.and.callFake(async (p: string, content: string) => {
        if (p === maraPath) return { success: false, error: 'read-only' };
        files.set(p, content);
        return { success: true };
      });

      const snapshot = await service.removeLinks('characters', 'mara-vell');

      expect(snapshot.removals.map((r) => r.relativePath)).toEqual(['places/Grey Harbor.md']);
      expect(parsePromptFile(files.get(maraPath)!).characters).toContain('mara-vell');
      expect(TestBed.inject(NotificationService).showWarning).toHaveBeenCalled();
    });
  });
});
