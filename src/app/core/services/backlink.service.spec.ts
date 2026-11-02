import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { BacklinkService } from './backlink.service';
import { CharacterService } from './character.service';
import { LocationService } from './location.service';
import { HouseService } from './house.service';
import { ProjectService } from './project.service';
import { FileWatcherService } from './file-watcher.service';
import { ElectronService } from './electron.service';
import { LoggingService } from './logging.service';

describe('BacklinkService', () => {
  let service: BacklinkService;

  const mara = {
    id: 'c-mara', name: 'Mara Vell', lore: false, draft: false,
    content: 'Keeper of [[Port Saltmere]].', books: ['lc1'], relativePath: 'mara-vell.md',
  };
  const port = {
    id: 'l-port', name: 'Port Saltmere', content: 'A harbor city.', books: [], relativePath: '_port-saltmere.md',
  };
  const project = { path: '/w', metadata: { settings: {}, books: [] } };

  function makeService(overrides: { characters?: Record<string, unknown> } = {}): BacklinkService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CharacterService,
          useValue: {
            getReferenceCharacters: () => of([mara]),
            getDrafts: () => of([]),
            getReferenceCharactersSnapshot: () => [mara],
            getDraftsSnapshot: () => [],
            getBookPageContent: async () => 'A page mentioning [[Port Saltmere]].',
            ...(overrides.characters || {}),
          },
        },
        {
          provide: LocationService,
          useValue: {
            getLocations: () => of([port]),
            getLocationsSnapshot: () => [port],
            loadLocations: async () => {},
          },
        },
        { provide: HouseService, useValue: { houses$: of([]), getSnapshot: () => [], loadHouses: async () => {} } },
        { provide: ProjectService, useValue: { currentProject$: of(project), getCurrentProject: () => project } },
        { provide: FileWatcherService, useValue: { fileChanges$: new Subject() } },
        { provide: ElectronService, useValue: { readFile: async () => '' } },
        { provide: LoggingService, useValue: { error: () => {} } },
      ],
    });
    return TestBed.inject(BacklinkService);
  }

  it('indexes a record description and its book page as mentions of the target', async () => {
    service = makeService();
    await service.rebuild();

    const backlinks = service.backlinksFor('l-port');
    expect(backlinks.length).toBe(2);
    expect(backlinks.map((b) => b.sourceName)).toEqual(['Mara Vell', 'Mara Vell']);
    expect(backlinks[0].snippet).toContain('[Port Saltmere]');
  });

  it('captures unresolved links as excluded and counts them by name', async () => {
    service = makeService({
      characters: {
        getReferenceCharactersSnapshot: () => [{ ...mara, content: 'A [[Ghost]] appears.' }],
        getBookPageContent: async () => null,
      },
    });
    await service.rebuild();

    expect(service.backlinksFor('c-mara').length).toBe(0);
    expect(service.index.excluded.length).toBe(1);
    expect(service.excludedCountFor('Ghost')).toBe(1);
  });

  it('keys the index by resolved target id, not the source', async () => {
    service = makeService({ characters: { getBookPageContent: async () => null } });
    await service.rebuild();

    // Mara's description links to Port Saltmere, so Port has a mention and Mara has none.
    expect(service.backlinksFor('l-port').length).toBe(1);
    expect(service.backlinksFor('c-mara').length).toBe(0);
  });

  it('indexes drafts as link targets and points draft sources at the draft route', async () => {
    const heir = {
      id: 'd-heir', name: 'Secret Heir', draft: true,
      content: 'Heir of [[Port Saltmere]].', books: [], relativePath: '@drafts/secret-heir/secret-heir.md',
    };
    service = makeService({
      characters: {
        getReferenceCharactersSnapshot: () => [{ ...mara, content: 'The [[Secret Heir]] sails.' }],
        getDraftsSnapshot: () => [heir],
        getBookPageContent: async () => null,
      },
    });
    await service.rebuild();

    // A mention of a draft resolves to the draft…
    expect(service.backlinksFor('d-heir').map((b) => b.sourceName)).toEqual(['Mara Vell']);
    // …and a mention from a draft points at the draft route, not the character route.
    const fromDraft = service.backlinksFor('l-port')[0];
    expect(fromDraft.sourceType).toBe('draft');
    expect(fromDraft.href).toBe('#/character-draft/d-heir');
  });
});
