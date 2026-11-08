import { MetadataManagementComponent } from './metadata-management.component';
import { Character } from '../../core/interfaces/character.interface';

/** Delete confirmation for categories and tags: says how many characters use them. */
describe('MetadataManagementComponent delete confirmation', () => {
  const character = (overrides: Partial<Character>): Character =>
    ({ id: 'x', name: 'X', category: 'main-character', tags: [], books: [], ...overrides }) as Character;

  let component: MetadataManagementComponent;
  let metadataService: jasmine.SpyObj<{ removeCategory(id: string): Promise<void>; removeTag(id: string): Promise<void> }>;

  beforeEach(() => {
    jasmine.clock().install();
    metadataService = jasmine.createSpyObj('MetadataService', ['removeCategory', 'removeTag']);
    metadataService.removeCategory.and.resolveTo();
    metadataService.removeTag.and.resolveTo();
    // Only the delete-confirmation members are exercised, so skip the heavy constructor.
    component = Object.create(MetadataManagementComponent.prototype);
    Object.assign(component, {
      pendingDelete: null,
      pendingDeleteTimeout: null,
      saving: false,
      settings: { defaultCategory: 'main-character' },
      metadataService,
      logger: jasmine.createSpyObj('LoggingService', ['error']),
      characterService: {
        getReferenceCharactersSnapshot: () => [
          character({ id: 'ilse', bookCategories: { lc1: 'antagonist' }, bookTags: { lc2: ['tide-touched'] } }),
          character({ id: 'saffi', tags: ['tide-touched'] }),
          character({ id: 'olm', category: 'antagonist' }),
        ],
        getDraftsSnapshot: () => [character({ id: 'wren', bookTags: { lc1: ['tide-touched'] } })],
      },
    });
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('says how many characters (per-book overrides and drafts included) use a tag before deleting it', async () => {
    const tag = { id: 'tide-touched', name: 'Tide Touched', color: '#0ff' };

    await component.deleteTag(tag);

    expect(metadataService.removeTag).not.toHaveBeenCalled();
    expect(component.deleteConfirmLabel('tag', tag.id)).toBe('Used by 3 characters. Delete?');

    await component.deleteTag(tag);
    expect(metadataService.removeTag).toHaveBeenCalledOnceWith('tide-touched');
  });

  it('says how many characters use a category, and when none do', async () => {
    const antagonist = { id: 'antagonist', name: 'Antagonist', color: '#000' };
    const mentor = { id: 'mentor', name: 'Mentor', color: '#111' };

    await component.deleteCategory(antagonist);
    expect(component.deleteConfirmLabel('category', antagonist.id)).toBe('Used by 2 characters. Delete?');

    await component.deleteCategory(mentor);
    expect(component.deleteConfirmLabel('category', mentor.id)).toBe('No characters use it. Delete?');
    expect(metadataService.removeCategory).not.toHaveBeenCalled();
  });
});
