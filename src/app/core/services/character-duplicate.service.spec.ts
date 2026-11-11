import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { asciiSlugify } from '../utils/slug.utils';
import { buildWikiLinkTargets } from '../utils/wiki-links.utils';
import { Character } from '../interfaces/character.interface';
import { CharacterDuplicateNoticeService } from './character-duplicate-notice.service';
import { CharacterDuplicateService } from './character-duplicate.service';
import { CharacterService } from './character.service';
import { HouseService } from './house.service';
import { LocationService } from './location.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { ProjectService } from './project.service';

describe('CharacterDuplicateService', () => {
  let service: CharacterDuplicateService;
  let characters: jasmine.SpyObj<CharacterService>;
  let router: jasmine.SpyObj<Router>;
  let notifications: jasmine.SpyObj<NotificationService>;

  const mara = { id: 'mara-id', name: 'Mara', relativePath: 'mara/mara.md' } as Character;

  beforeEach(() => {
    characters = jasmine.createSpyObj('CharacterService', ['duplicateCharacter', 'getRecordNames']);
    characters.getRecordNames.and.returnValue(['Mara', 'mara', 'Mara (copy)', 'mara-copy']);
    const locations = jasmine.createSpyObj('LocationService', ['loadLocations', 'getLocationsSnapshot']);
    locations.loadLocations.and.resolveTo();
    locations.getLocationsSnapshot.and.returnValue([{ name: 'Mara (copy 2)', relativePath: '_harbor.md' }]);
    const houses = jasmine.createSpyObj('HouseService', ['loadHouses', 'getSnapshot']);
    houses.loadHouses.and.resolveTo();
    houses.getSnapshot.and.returnValue([]);
    const projects = jasmine.createSpyObj('ProjectService', ['getCurrentProject']);
    projects.getCurrentProject.and.returnValue({ path: '/p' });
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.resolveTo(true);
    notifications = jasmine.createSpyObj('NotificationService', ['showError', 'showSuccess']);

    TestBed.configureTestingModule({
      providers: [
        CharacterDuplicateService,
        { provide: CharacterService, useValue: characters },
        { provide: LocationService, useValue: locations },
        { provide: HouseService, useValue: houses },
        { provide: ProjectService, useValue: projects },
        { provide: Router, useValue: router },
        { provide: NotificationService, useValue: notifications },
        { provide: LoggingService, useValue: jasmine.createSpyObj('LoggingService', ['error', 'warn']) },
      ],
    });
    service = TestBed.inject(CharacterDuplicateService);
  });

  it('names the copy uniquely across all link targets and opens it', async () => {
    characters.duplicateCharacter.and.callFake(async (_id, name) => ({ ...mara, id: 'new-id', name }));

    const copy = await service.duplicate(mara);

    expect(characters.duplicateCharacter).toHaveBeenCalledWith('mara-id', 'Mara (copy 3)');
    expect(copy?.id).toBe('new-id');
    expect(router.navigate).toHaveBeenCalledWith(['/character', 'new-id'], { state: { duplicatedFrom: 'Mara' } });
    expect(notifications.showSuccess).toHaveBeenCalledWith('Created “Mara (copy 3)”.');
  });

  for (const kind of ['location', 'house'] as const) {
    it(`preserves ${kind} alias links when choosing the copy name and stem`, async () => {
      const owner = { id: 'owner', name: 'Other record', relativePath: 'other.md',
        aliases: ['mArA (CoPy)', 'mara-copy-2'] };
      characters.getRecordNames.and.returnValue(['Mara']);
      const locations = TestBed.inject(LocationService) as jasmine.SpyObj<LocationService>;
      const houses = TestBed.inject(HouseService) as jasmine.SpyObj<HouseService>;
      locations.getLocationsSnapshot.and.returnValue(kind === 'location' ? [owner as any] : []);
      houses.getSnapshot.and.returnValue(kind === 'house' ? [owner as any] : []);
      const collection = { targets: [owner], folder: kind === 'location' ? 'locations' : 'houses',
        route: kind, singular: kind };
      const before = buildWikiLinkTargets([collection]);
      owner.aliases.forEach(alias => expect(before.resolve(alias).id).toBe(owner.id));
      characters.duplicateCharacter.and.callFake(async (_id, name) => ({
        ...mara, id: 'copy', name, relativePath: `${asciiSlugify(name)}/${asciiSlugify(name)}.md`,
      }));

      const copy = await service.duplicate(mara);

      expect(copy?.name).toBe('Mara (copy 3)');
      const after = buildWikiLinkTargets([collection,
        { targets: [mara, copy!], folder: 'characters', route: 'character', singular: 'Character' }]);
      owner.aliases.forEach(alias => expect(after.resolve(alias)).toEqual(before.resolve(alias)));
    });
  }

  it('opens a draft copy on the draft page', async () => {
    characters.duplicateCharacter.and.resolveTo({ ...mara, id: 'd2', draft: true } as Character);
    await service.duplicate({ ...mara, draft: true } as Character);
    expect(router.navigate.calls.mostRecent().args[0]).toEqual(['/character-draft', 'd2']);
  });

  it('shows an error toast and stays put on failure', async () => {
    characters.duplicateCharacter.and.rejectWith(new Error('Failed to duplicate character: EIO'));

    expect(await service.duplicate(mara)).toBeNull();
    expect(notifications.showError).toHaveBeenCalledWith('Failed to duplicate character: EIO');
    expect(notifications.showSuccess).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
  it('keeps independent notices for multiple copies and isolates matching ids in other projects', async () => {
    const notices = TestBed.inject(CharacterDuplicateNoticeService);
    characters.duplicateCharacter.and.resolveTo({ ...mara, id: 'copy-1' });
    await service.duplicate(mara);
    characters.duplicateCharacter.and.resolveTo({ ...mara, id: 'copy-2' });
    await service.duplicate({ ...mara, name: 'Second original' });

    expect(notices.get('/p', 'copy-1')).toBe('Mara');
    expect(notices.get('/p', 'copy-2')).toBe('Second original');
    expect(notices.get('/another-project', 'copy-1')).toBeNull();
    notices.remember('/another-project', 'copy-1', 'Other original');
    notices.dismiss('/p', 'copy-1');
    expect(notices.get('/p', 'copy-1')).toBeNull();
    expect(notices.get('/p', 'copy-2')).toBe('Second original');
    expect(notices.get('/another-project', 'copy-1')).toBe('Other original');
  });

  it('retains the notice when navigation to a successfully created copy is cancelled', async () => {
    characters.duplicateCharacter.and.resolveTo({ ...mara, id: 'copy' });
    router.navigate.and.resolveTo(false);
    await service.duplicate(mara);
    expect(TestBed.inject(CharacterDuplicateNoticeService).get('/p', 'copy')).toBe('Mara');
  });

});
