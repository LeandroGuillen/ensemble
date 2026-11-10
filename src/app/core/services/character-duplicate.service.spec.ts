import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Character } from '../interfaces/character.interface';
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
});
