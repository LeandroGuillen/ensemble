import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Command, CommandPaletteService } from './command-palette.service';
import { ProjectWriteProtectionService } from '../../core/services/project-write-protection.service';
import { CharacterCommandService } from '../../core/services/character-command.service';
import { LocationCommandService } from '../../core/services/location-command.service';
import { HouseCommandService } from '../../core/services/house-command.service';
import { AddConceptCommandService } from '../../core/services/add-concept-command.service';
import { AddNameCommandService } from '../../core/services/add-name-command.service';
import { CharacterService } from '../../core/services/character.service';
import { LocationService } from '../../core/services/location.service';
import { HouseService } from '../../core/services/house.service';
import { CharacterEditDialogService } from '../../core/services/character-edit-dialog.service';
import { CharacterDuplicateService } from '../../core/services/character-duplicate.service';
import { CharacterPickerService } from '../../core/services/character-picker.service';
import { MetadataHelperService } from '../../core/services/metadata-helper.service';
import { BackstageService } from '../../core/services/backstage.service';
import { NotificationService } from '../../core/services/notification.service';
import { LoggingService } from '../../core/services/logging.service';

describe('Read-only project palette commands', () => {
  const mutatingIds = ['new-character', 'duplicate-character', 'new-location', 'new-house', 'add-concept', 'add-name'];
  let palette: CommandPaletteService;
  let protection: ProjectWriteProtectionService;
  let commands: Command[];
  let references: BehaviorSubject<any[]>;
  let edit: jasmine.SpyObj<CharacterEditDialogService>;
  let picker: jasmine.SpyObj<CharacterPickerService>;

  beforeEach(() => {
    references = new BehaviorSubject<any[]>([{ id: 'mara', name: 'Mara', category: 'main', tags: [], books: [] }]);
    edit = jasmine.createSpyObj('CharacterEditDialogService', ['openCreate', 'openEdit']);
    picker = jasmine.createSpyObj('CharacterPickerService', ['pick']);
    TestBed.configureTestingModule({ providers: [
      { provide: CharacterService, useValue: {
        getReferenceCharacters: () => references,
        getReferenceCharactersSnapshot: () => references.value,
        getCachedThumbnail: () => null,
        loadThumbnailsForCharacters: () => Promise.resolve(),
      } },
      { provide: LocationService, useValue: {
        getLocations: () => new BehaviorSubject([]), getLocationsSnapshot: () => [],
        loadThumbnailsForLocations: () => Promise.resolve(),
      } },
      { provide: HouseService, useValue: { houses$: new BehaviorSubject([]), getSnapshot: () => [] } },
      { provide: CharacterEditDialogService, useValue: edit },
      { provide: CharacterPickerService, useValue: picker },
      { provide: CharacterDuplicateService, useValue: {} },
      { provide: MetadataHelperService, useValue: { getCategoryName: () => 'Main' } },
      { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
      { provide: BackstageService, useValue: {} },
      { provide: NotificationService, useValue: {} },
      { provide: LoggingService, useValue: {} },
    ] });
    palette = TestBed.inject(CommandPaletteService);
    protection = TestBed.inject(ProjectWriteProtectionService);
    commands = [];
    palette.commands$.subscribe(value => commands = value);
  });

  function register(): void {
    TestBed.inject(CharacterCommandService).activate();
    TestBed.inject(LocationCommandService).activate();
    TestBed.inject(HouseCommandService).activate();
    TestBed.inject(AddConceptCommandService).register();
    TestBed.inject(AddNameCommandService).register();
  }

  it('hides every create/duplicate action on a read-only project, including after thumbnail refresh', async () => {
    protection.readOnlyPath = '/read-only';
    register();
    await Promise.resolve();
    palette.open();
    for (const id of mutatingIds) expect(commands.map(command => command.id)).not.toContain(id);
    expect(commands.map(command => command.id)).toContain('view-houses');
    commands.find(command => command.id === 'character-mara')!.action();
    expect(edit.openEdit).toHaveBeenCalledWith('mara');
  });

  it('rechecks protection on open and execution, and restores commands for a writable project', () => {
    register();
    for (const id of mutatingIds) expect(commands.map(command => command.id)).toContain(id);
    const create = commands.find(command => command.id === 'new-character')!;
    const duplicate = commands.find(command => command.id === 'duplicate-character')!;
    protection.readOnlyPath = '/read-only';
    create.action();
    duplicate.action();
    expect(edit.openCreate).not.toHaveBeenCalled();
    expect(picker.pick).not.toHaveBeenCalled();
    palette.open();
    for (const id of mutatingIds) expect(commands.map(command => command.id)).not.toContain(id);
    protection.readOnlyPath = null;
    palette.open();
    for (const id of mutatingIds) expect(commands.map(command => command.id)).toContain(id);
    commands.find(command => command.id === 'new-character')!.action();
    expect(edit.openCreate).toHaveBeenCalledTimes(1);
  });
});
