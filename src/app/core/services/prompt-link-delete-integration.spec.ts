import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { ReferenceCleanupService } from './reference-cleanup.service';
import { PromptService } from './prompt.service';
import { CharacterService } from './character.service';
import { LocationService } from './location.service';
import { HouseService } from './house.service';
import { PlotBoardService } from './plot-board.service';
import { CastService } from './cast.service';
import { MetadataService } from './metadata.service';
import { PinboardService } from './pinboard.service';
import { ProjectService } from './project.service';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { UndoDeleteEntry, UndoDeleteService } from './undo-delete.service';
import { Character } from '../interfaces/character.interface';
import { Location } from '../interfaces/location.interface';
import { parsePromptFile } from '../utils/prompt-file.utils';
import { buildCharacterDeleteMessage } from '../../features/character-detail/character-delete-message.utils';

/**
 * Deleting a character, draft or location linked from prompt files (real
 * CharacterService / LocationService / ReferenceCleanupService / PromptService):
 * the dialog lists the prompts, the delete unlinks them, Undo relinks them.
 */
describe('Prompt links on character / location delete (real DI)', () => {
  const PROJECT = '/vault';
  const PROMPTS = `${PROJECT}/prompts`;
  const MARA_PROMPT = `${PROMPTS}/characters/Mara Vell.md`;
  const HARBOR_PROMPT = `${PROMPTS}/places/Grey Harbor.md`;
  const DRAFT_PROMPT = `${PROMPTS}/characters/Sketch.md`;

  let disk: Map<string, string>;
  let characterService: CharacterService;
  let locationService: LocationService;
  let promptService: PromptService;
  let undoDelete: jasmine.SpyObj<UndoDeleteService>;

  const record = (over: Partial<Character>): Character => ({
    id: 'mara-vell',
    name: 'Mara Vell',
    category: 'main',
    tags: [],
    books: [],
    prompts: [],
    content: '',
    created: new Date(),
    modified: new Date(),
    relativePath: 'mara-vell/mara-vell.md',
    filePath: `${PROJECT}/characters/mara-vell/mara-vell.md`,
    ...over,
  });

  const links = (path: string) => {
    const data = parsePromptFile(disk.get(path)!);
    return { characters: data.characters, locations: data.locations };
  };

  const lastUndoEntry = (): UndoDeleteEntry => undoDelete.register.calls.mostRecent().args[1];

  beforeEach(() => {
    disk = new Map([
      [MARA_PROMPT, '---\ncharacters:\n  - mara-vell\n---\n```prompt\n1woman, grey cloak\n```\n'],
      [
        HARBOR_PROMPT,
        '---\ncharacters:\n  - ben\n  - mara-vell\nlocations:\n  - grey-harbor\n  - lighthouse\n---\nfog\n',
      ],
      [DRAFT_PROMPT, '---\ncharacters:\n  - sketch\n---\nrough idea\n'],
    ]);

    const electron = jasmine.createSpyObj<ElectronService>('ElectronService', [
      'isElectron', 'fileExists', 'createDirectory', 'readDirectoryRecursive', 'readFile',
      'writeFileAtomic', 'stageForTrash', 'restoreFromTrash', 'getImageAsDataUrl',
    ]);
    electron.isElectron.and.returnValue(true);
    electron.fileExists.and.callFake(async (p: string) => p === PROMPTS || disk.has(p));
    electron.createDirectory.and.resolveTo({ success: true });
    electron.readDirectoryRecursive.and.callFake(async (root: string) => ({
      success: true,
      files: [...disk.keys()]
        .filter((p) => p.startsWith(`${root}/`) && p.endsWith('.md'))
        .map((absolutePath) => ({ absolutePath, relativePath: absolutePath.slice(root.length + 1) })),
    }));
    electron.readFile.and.callFake(async (p: string) =>
      disk.has(p) ? { success: true, content: disk.get(p)! } : { success: false, error: 'missing' }
    );
    electron.writeFileAtomic.and.callFake(async (p: string, content: string) => {
      disk.set(p, content);
      return { success: true };
    });
    electron.stageForTrash.and.resolveTo({ success: true, token: 'tok', expiresAt: Date.now() + 15000 });
    electron.getImageAsDataUrl.and.resolveTo(null);

    const project = { path: PROJECT, metadata: { settings: {}, books: [], categories: [], tags: [] } } as any;
    const projectService = jasmine.createSpyObj<ProjectService>(
      'ProjectService',
      ['getCurrentProject', 'getPromptsFolderPath', 'getCharactersFolderPath', 'getLocationsFolderPath', 'getDefaultCharacterStyle'],
      { currentProject$: new BehaviorSubject(project) }
    );
    projectService.getCurrentProject.and.returnValue(project);
    projectService.getPromptsFolderPath.and.returnValue(PROMPTS);
    projectService.getCharactersFolderPath.and.returnValue(`${PROJECT}/characters`);
    projectService.getLocationsFolderPath.and.returnValue(`${PROJECT}/locations`);
    projectService.getDefaultCharacterStyle.and.returnValue('default');

    // Other reference kinds are covered elsewhere; here they hold nothing.
    const house = jasmine.createSpyObj('HouseService', [
      'countCharacterReferences', 'removeCharacterFromHouses', 'restoreCharacterToHouses',
      'clearLocationReferences', 'restoreLocationReferences',
    ]);
    house.countCharacterReferences.and.returnValue([]);
    house.removeCharacterFromHouses.and.callFake(async (characterId: string) => ({ characterId, removals: [] }));
    house.restoreCharacterToHouses.and.resolveTo({ restored: 0, skipped: [] });
    house.clearLocationReferences.and.callFake(async (locationId: string) => ({ locationId, seats: [] }));
    house.restoreLocationReferences.and.resolveTo({ restored: 0, skipped: [] });
    const plot = jasmine.createSpyObj('PlotBoardService', [
      'countCharacterReferences', 'removeCharacterFromThreads', 'restoreCharacterToThreads',
    ]);
    plot.countCharacterReferences.and.resolveTo([]);
    plot.removeCharacterFromThreads.and.callFake(async (characterId: string) => ({ characterId, removals: [] }));
    plot.restoreCharacterToThreads.and.resolveTo({ restored: 0, skipped: [] });
    const cast = jasmine.createSpyObj('CastService', [
      'countCharacterInCasts', 'removeCharacterFromCasts', 'restoreCharacterToCasts',
    ]);
    cast.countCharacterInCasts.and.returnValue([]);
    cast.removeCharacterFromCasts.and.callFake(async (characterId: string) => ({ characterId, removals: [] }));
    cast.restoreCharacterToCasts.and.resolveTo({ restored: 0, skipped: [] });
    const metadata = jasmine.createSpyObj('MetadataService', [
      'removeCharacterFromBookPovs', 'restoreCharacterToBookPovs',
    ]);
    metadata.removeCharacterFromBookPovs.and.callFake(async (characterId: string) => ({ characterId, removals: [] }));
    metadata.restoreCharacterToBookPovs.and.resolveTo({ restored: 0, skipped: [] });
    const pinboard = jasmine.createSpyObj('PinboardService', [
      'countCharacterReferences', 'removeCharacterConnections', 'restoreCharacterConnections',
    ]);
    pinboard.countCharacterReferences.and.returnValue([]);
    pinboard.removeCharacterConnections.and.callFake(async (characterId: string) => ({ characterId, removals: [] }));
    pinboard.restoreCharacterConnections.and.resolveTo({ restored: 0, skipped: [] });

    undoDelete = jasmine.createSpyObj<UndoDeleteService>('UndoDeleteService', ['register', 'dismissAll']);

    TestBed.configureTestingModule({
      providers: [
        ReferenceCleanupService,
        PromptService,
        CharacterService,
        LocationService,
        { provide: HouseService, useValue: house },
        { provide: PlotBoardService, useValue: plot },
        { provide: CastService, useValue: cast },
        { provide: MetadataService, useValue: metadata },
        { provide: PinboardService, useValue: pinboard },
        { provide: ElectronService, useValue: electron },
        { provide: ProjectService, useValue: projectService },
        { provide: FileWatcherService, useValue: { fileChanges$: new Subject() } },
        { provide: LoggingService, useValue: jasmine.createSpyObj('LoggingService', ['log', 'warn', 'error']) },
        {
          provide: NotificationService,
          useValue: jasmine.createSpyObj('NotificationService', ['showSuccess', 'showError', 'showWarning']),
        },
        { provide: UndoDeleteService, useValue: undoDelete },
      ],
    });

    characterService = TestBed.inject(CharacterService);
    locationService = TestBed.inject(LocationService);
    promptService = TestBed.inject(PromptService);

    (characterService as any).charactersSubject.next([
      record({}),
      record({ id: 'ben', name: 'Ben', relativePath: 'ben/ben.md', filePath: `${PROJECT}/characters/ben/ben.md` }),
    ]);
    (characterService as any).draftsSubject.next([
      record({
        id: 'sketch',
        name: 'Sketch',
        category: '',
        draft: true,
        relativePath: '@drafts/sketch/sketch.md',
        filePath: `${PROJECT}/characters/@drafts/sketch/sketch.md`,
      }),
    ]);
    const harbor: Location = {
      id: 'grey-harbor',
      name: 'Grey Harbor',
      books: [],
      content: '',
      created: new Date(),
      modified: new Date(),
      relativePath: '_grey-harbor.md',
      filePath: `${PROJECT}/locations/_grey-harbor.md`,
    } as Location;
    (locationService as any).locationsSubject.next([harbor]);
  });

  it('the character delete dialog lists the linked prompts', async () => {
    const message = await buildCharacterDeleteMessage('Mara Vell', 'mara-vell', false, {
      characterService,
      logger: { error: () => {} },
    });

    expect(message).toContain('This character will be removed from:\n• 2 prompts: Mara Vell, Grey Harbor');
  });

  it('deleting a character unlinks it from its prompts, and Undo puts the links back exactly', async () => {
    const before = { mara: links(MARA_PROMPT), harbor: links(HARBOR_PROMPT) };

    await characterService.deleteCharacter('mara-vell');

    expect(links(MARA_PROMPT).characters).toEqual([]);
    expect(links(HARBOR_PROMPT)).toEqual({ characters: ['ben'], locations: ['grey-harbor', 'lighthouse'] });
    expect(promptService.promptsForCharacter('mara-vell')).toEqual([]);

    const entry = lastUndoEntry();
    const result = await entry.restoreReferences(entry.referenceSnapshot);

    expect(result.skipped).toEqual([]);
    expect(links(MARA_PROMPT)).toEqual(before.mara);
    expect(links(HARBOR_PROMPT)).toEqual(before.harbor);
    expect(promptService.promptsForCharacter('mara-vell').map((f) => f.relativePath)).toEqual([
      'characters/Mara Vell.md',
      'places/Grey Harbor.md',
    ]);
  });

  it('deleting a draft linked from a prompt lists it, unlinks it, and Undo relinks it', async () => {
    const message = await buildCharacterDeleteMessage('Sketch', 'sketch', true, {
      characterService,
      logger: { error: () => {} },
    });
    expect(message).toContain('This draft will be removed from:\n• 1 prompt: Sketch');

    await characterService.deleteCharacter('sketch');
    expect(links(DRAFT_PROMPT).characters).toEqual([]);

    const entry = lastUndoEntry();
    await entry.restoreReferences(entry.referenceSnapshot);
    expect(links(DRAFT_PROMPT).characters).toEqual(['sketch']);
  });

  it('deleting a location lists, unlinks and (on Undo) relinks its prompts', async () => {
    expect(await locationService.countLocationReferences('grey-harbor')).toEqual({
      prompts: [{ id: 'places/Grey Harbor.md', name: 'Grey Harbor' }],
    });
    const before = links(HARBOR_PROMPT);

    await locationService.deleteLocation('grey-harbor');

    expect(links(HARBOR_PROMPT)).toEqual({ characters: ['ben', 'mara-vell'], locations: ['lighthouse'] });

    const entry = lastUndoEntry();
    const result = await entry.restoreReferences(entry.referenceSnapshot);

    expect(result.skipped).toEqual([]);
    expect(links(HARBOR_PROMPT)).toEqual(before);
  });
});
