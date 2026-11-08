import { TestBed } from '@angular/core/testing';
import { of, firstValueFrom } from 'rxjs';
import { WikiLinkTargets } from '../utils/wiki-links.utils';
import { WikiLinkRoute, WikiLinkTargetsService } from './wiki-link-targets.service';
import { CharacterService } from './character.service';
import { LocationService } from './location.service';
import { HouseService } from './house.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';

describe('WikiLinkTargetsService', () => {
  const mara = { id: 'c-mara', name: 'Mara Vell', relativePath: 'mara-vell/mara-vell.md' };
  const heir = { id: 'd-heir', name: 'Secret Heir', relativePath: '@drafts/secret-heir/secret-heir.md' };
  const project = { path: '/w', metadata: { settings: {} } };

  function targetsFor(primary: WikiLinkRoute, drafts: object[] = [heir], settings: object = {}): Promise<WikiLinkTargets> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CharacterService,
          useValue: {
            getReferenceCharacters: () => of([mara]),
            getDrafts: () => of(drafts),
          },
        },
        { provide: LocationService, useValue: { getLocations: () => of([]), loadLocations: async () => {} } },
        { provide: HouseService, useValue: { houses$: of([]), loadHouses: async () => {} } },
        { provide: ProjectService, useValue: { currentProject$: of({ ...project, metadata: { settings } }) } },
        { provide: LoggingService, useValue: { error: () => {} } },
      ],
    });
    return firstValueFrom(TestBed.inject(WikiLinkTargetsService).targets$(primary));
  }

  it('resolves a draft name to the draft route', async () => {
    const { resolve } = await targetsFor('character');
    expect(resolve('Secret Heir')).toEqual(jasmine.objectContaining({
      state: 'resolved',
      id: 'd-heir',
      href: '#/character-draft/d-heir',
      route: 'character-draft',
    }));
  });

  it('suggests a draft by name like any other note', async () => {
    const { suggestions } = await targetsFor('character');
    expect(suggestions).toEqual([
      jasmine.objectContaining({ label: 'Mara Vell', target: 'Mara Vell', type: 'character' }),
      jasmine.objectContaining({ label: 'Secret Heir', target: 'Secret Heir', type: 'character-draft', detail: 'Draft' }),
    ]);
  });

  it('resolves a draft by its drafts path and keeps missing links on the primary route', async () => {
    const { resolve } = await targetsFor('location');
    expect(resolve('@drafts/secret-heir/secret-heir')).toEqual(jasmine.objectContaining({
      state: 'resolved',
      href: '#/character-draft/d-heir',
    }));
    // Missing links are still created in the primary collection, never as drafts.
    expect(resolve('Missing')).toEqual(jasmine.objectContaining({
      state: 'missing',
      href: '#/location?name=Missing&fromLink=1',
    }));
  });

  describe('a draft with the same name as a character', () => {
    const maraDraft = { id: 'd-mara', name: 'Mara Vell', relativePath: '@drafts/mara-vell/mara-vell.md' };
    const routes: WikiLinkRoute[] = ['character', 'location', 'house'];

    it('leaves [[Name]] on the published character in every editor', async () => {
      for (const primary of routes) {
        const { resolve } = await targetsFor(primary, [maraDraft]);
        expect(resolve('Mara Vell')).withContext(primary).toEqual(jasmine.objectContaining({
          state: 'resolved', id: 'c-mara', href: '#/character/c-mara',
        }));
        expect(resolve('mara-vell')).withContext(primary).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'c-mara' }));
      }
    });

    it('reaches the draft by its vault path and by the legacy @drafts path', async () => {
      for (const primary of routes) {
        const { resolve } = await targetsFor(primary, [maraDraft]);
        for (const path of ['characters/@drafts/mara-vell/mara-vell', '@drafts/mara-vell/mara-vell', 'Characters/@drafts/mara-vell/mara-vell.md']) {
          expect(resolve(path)).withContext(`${primary} ${path}`).toEqual(jasmine.objectContaining({
            state: 'resolved', id: 'd-mara', href: '#/character-draft/d-mara', route: 'character-draft',
          }));
        }
        expect(resolve('characters/mara-vell/mara-vell')).withContext(primary)
          .toEqual(jasmine.objectContaining({ state: 'resolved', id: 'c-mara' }));
      }
    });

    it('suggests the character by name and the draft by its vault path', async () => {
      const { suggestions, resolve } = await targetsFor('character', [maraDraft]);
      expect(suggestions).toEqual([
        jasmine.objectContaining({ label: 'Mara Vell', target: 'Mara Vell', type: 'character' }),
        jasmine.objectContaining({ label: 'Mara Vell', target: 'characters/@drafts/mara-vell/mara-vell', type: 'character-draft' }),
      ]);
      for (const suggestion of suggestions) {
        expect(resolve(suggestion.target).route).toBe(suggestion.type!);
      }
    });

    it('uses the configured characters folder for draft paths', async () => {
      const { suggestions, resolve } = await targetsFor('location', [maraDraft], { charactersFolder: 'people' });
      expect(suggestions[1].target).toBe('people/@drafts/mara-vell/mara-vell');
      expect(resolve('people/@drafts/mara-vell/mara-vell').id).toBe('d-mara');
    });
  });

  it('resolves [[characters/@drafts/...]] to a draft with a unique name', async () => {
    const { resolve } = await targetsFor('character');
    expect(resolve('characters/@drafts/secret-heir/secret-heir')).toEqual(jasmine.objectContaining({
      state: 'resolved', id: 'd-heir', href: '#/character-draft/d-heir',
    }));
  });

  it('keeps two drafts with the same name ambiguous and suggests them by path', async () => {
    const other = { id: 'd-heir-2', name: 'Secret Heir', relativePath: '@drafts/secret-heir-2/secret-heir-2.md' };
    const { resolve, suggestions } = await targetsFor('character', [heir, other]);
    expect(resolve('Secret Heir').state).toBe('ambiguous');
    expect(suggestions.filter((s) => s.type === 'character-draft').map((s) => s.target)).toEqual([
      'characters/@drafts/secret-heir/secret-heir', 'characters/@drafts/secret-heir-2/secret-heir-2',
    ]);
  });
});
