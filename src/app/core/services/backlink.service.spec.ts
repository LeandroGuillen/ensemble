import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MentionedInComponent } from '../../shared/mentioned-in/mentioned-in.component';
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
      imports: [MentionedInComponent],
      providers: [
        provideRouter([{ path: 'character-draft/:id', component: MentionedInComponent }]),
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

  // CharacterService normalizes a missing frontmatter name to an empty string.
  for (const { name, relativePath, expected } of [
    { name: '', relativePath: '@drafts/secret-heir/secret-heir.md', expected: 'secret-heir.md' },
    { name: '  ', relativePath: '@drafts\\secret-heir\\secret-heir.md', expected: 'secret-heir.md' },
    { name: '', relativePath: '', expected: 'Untitled draft' },
    { name: 'Secret Heir', relativePath: '@drafts/secret-heir/secret-heir.md', expected: 'Secret Heir' },
  ]) {
    it(`labels draft descriptions and book pages as "${expected}" for name ${JSON.stringify(name)}`, async () => {
      const draft = {
        id: 'd-heir', name, draft: true, relativePath,
        content: 'Heir of [[Port Saltmere]].', books: ['lc1'],
      };
      service = makeService({
        characters: {
          getReferenceCharactersSnapshot: () => [],
          getDraftsSnapshot: () => [draft],
        },
      });
      await service.rebuild();

      const mentions = service.backlinksFor('l-port');
      expect(mentions.map((b) => b.sourceName)).toEqual([expected, expected]);
      expect(mentions.map((b) => b.sourceType)).toEqual(['draft', 'book']);
      expect(mentions.map((b) => b.href)).toEqual([
        '#/character-draft/d-heir', '#/character-draft/d-heir',
      ]);
      expect(draft.name).toBe(name);
    });
  }

  it('renders an unnamed draft filename in Mentioned in and opens that draft when clicked', async () => {
    service = makeService({
      characters: {
        getReferenceCharactersSnapshot: () => [],
        getDraftsSnapshot: () => [{
          id: 'd-heir', name: '', draft: true,
          relativePath: '@drafts/secret-heir/secret-heir.md',
          content: 'Heir of [[Port Saltmere]].', books: [],
        }],
      },
    });
    await service.rebuild();
    const fixture = TestBed.createComponent(MentionedInComponent);
    fixture.componentInstance.targetId = 'l-port';
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('.mention-link') as HTMLAnchorElement;
    expect(link.querySelector('.mention-source')?.textContent).toBe('secret-heir.md');
    link.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/character-draft/d-heir');
  });

  it('marks a draft\'s book page as a draft source, and leaves a character\'s book page unmarked', async () => {
    const heir = {
      id: 'd-heir', name: 'Secret Heir', draft: true,
      content: '', books: ['lc1'], relativePath: '@drafts/secret-heir/secret-heir.md',
    };
    service = makeService({
      characters: {
        getReferenceCharactersSnapshot: () => [{ ...mara, content: '' }],
        getDraftsSnapshot: () => [heir],
        getBookPageContent: async () => 'A page mentioning [[Port Saltmere]].',
      },
    });
    await service.rebuild();

    const pages = service.backlinksFor('l-port').filter((b) => b.sourceType === 'book');
    // Read the flag through a plain record so the spec compiles before the field existed.
    const draftPage: Record<string, unknown> = { ...pages.find((b) => b.sourceId === 'd-heir')! };
    const maraPage: Record<string, unknown> = { ...pages.find((b) => b.sourceId === 'c-mara')! };
    expect(draftPage['sourceDraft']).toBe(true);
    expect(draftPage['href']).toBe('#/character-draft/d-heir');
    expect(maraPage['sourceDraft']).toBeFalsy();
    expect(maraPage['href']).toBe('#/character/c-mara');
  });

  it('attributes mentions like the editors when a draft shares a character name', async () => {
    const maraDraft = {
      id: 'd-mara', name: 'Mara Vell', draft: true,
      content: '', books: [], relativePath: '@drafts/mara-vell/mara-vell.md',
    };
    const ben = {
      id: 'c-ben', name: 'Ben', lore: false, draft: false, books: [], relativePath: 'ben/ben.md',
      content: 'Sails with [[Mara Vell]]. The rewrite: [[characters/@drafts/mara-vell/mara-vell]], old link [[@drafts/mara-vell/mara-vell|Mara]].',
    };
    service = makeService({
      characters: {
        getReferenceCharactersSnapshot: () => [{ ...mara, content: '' }, ben],
        getDraftsSnapshot: () => [maraDraft],
        getBookPageContent: async () => null,
      },
    });
    await service.rebuild();

    expect(service.backlinksFor('c-mara').map((b) => b.snippet)).toEqual([jasmine.stringContaining('[Mara Vell]')]);
    expect(service.backlinksFor('d-mara').length).toBe(2);
    expect(service.index.excluded).toEqual([]);
    expect(service.excludedCountFor('Mara Vell')).toBe(0);
  });
});
