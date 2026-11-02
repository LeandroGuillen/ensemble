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

  function targetsFor(primary: WikiLinkRoute): Promise<WikiLinkTargets> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CharacterService,
          useValue: {
            getReferenceCharacters: () => of([mara]),
            getDrafts: () => of([heir]),
          },
        },
        { provide: LocationService, useValue: { getLocations: () => of([]), loadLocations: async () => {} } },
        { provide: HouseService, useValue: { houses$: of([]), loadHouses: async () => {} } },
        { provide: ProjectService, useValue: { currentProject$: of(project) } },
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
});
