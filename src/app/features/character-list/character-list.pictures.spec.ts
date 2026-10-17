import { CharacterListComponent } from './character-list.component';
import { CharacterService } from '../../core/services/character.service';
import { Character } from '../../core/interfaces';

describe('Character list book pictures', () => {
  let component: any;
  let service: any;
  let readImage: jasmine.Spy;
  const character = {
    id: 'casimir', name: 'Casimir', relativePath: 'Casimir.md',
    filePath: '/project/characters/Casimir.md', modified: new Date('2026-01-01'),
    thumbnails: { realistic: 'images/main.png', illustrated: 'images/drawing.png' },
    bookThumbnails: { first: { realistic: 'images/first.png' } },
  } as unknown as Character;

  beforeEach(() => {
    readImage = jasmine.createSpy().and.callFake(async (path: string) => `data:${path}`);
    service = Object.create(CharacterService.prototype);
    Object.assign(service, {
      thumbnailDataUrls: new Map(), thumbnailModificationTimes: new Map(),
      projectService: { getCurrentProject: () => ({ path: '/project' }), getDefaultCharacterStyle: () => 'realistic' },
      electronService: { getImageAsDataUrl: readImage }, logger: { error: jasmine.createSpy() },
    });
    component = Object.create(CharacterListComponent.prototype);
    Object.assign(component, {
      characterService: service, selectedCharacterStyle: 'realistic', selectedBook: '',
      allCharacters: [character], thumbnailDataUrls: new Map(), thumbnailModificationTimes: new Map(),
      cdr: { detectChanges: jasmine.createSpy() },
      recomputePovBadgeState: jasmine.createSpy(), applyFilters: jasmine.createSpy(),
    });
  });

  afterEach(() => localStorage.removeItem('characterSelectedBook'));

  it('shows the book picture, falls back for another book, and restores the main picture when cleared', async () => {
    component.selectedBook = 'first';
    await component.loadThumbnailDataUrls([character]);
    expect(component.getCharacterThumbnailDataUrl(character)).toBe('data:/project/images/first.png');
    component.selectedBook = 'second';
    await component.loadThumbnailDataUrls([character]);
    expect(component.getCharacterThumbnailDataUrl(character)).toBe('data:/project/images/main.png');
    component.selectedBook = '';
    await component.loadThumbnailDataUrls([character]);
    expect(component.getCharacterThumbnailDataUrl(character)).toBe('data:/project/images/main.png');
    expect([...component.thumbnailDataUrls.keys()]).toEqual(['casimir']);
  });

  it('falls back within the selected style and shows a placeholder when that style has no picture', async () => {
    component.selectedBook = 'first';
    component.selectedCharacterStyle = 'illustrated';
    await component.loadThumbnailDataUrls([character]);
    expect(component.getCharacterThumbnailDataUrl(character)).toBe('data:/project/images/drawing.png');
    component.selectedCharacterStyle = 'sketch';
    await component.loadThumbnailDataUrls([character]);
    expect(component.getCharacterThumbnailDataUrl(character)).toBeNull();
  });

  it('clears the previous book immediately and ignores its late result after changing the filter', async () => {
    let finishFirst!: (value: string) => void;
    readImage.and.callFake((path: string) => path.endsWith('/first.png')
      ? new Promise<string>(resolve => { finishFirst = resolve; })
      : Promise.resolve(`data:${path}`));
    component.selectedBook = 'first';
    const firstLoad = component.loadThumbnailDataUrls([character]);
    component.selectedBook = 'second';
    component.onBookChange();
    expect(component.getCharacterThumbnailDataUrl(character)).toBeNull();
    await component.loadThumbnailDataUrls([character]);
    finishFirst('data:late-first-book');
    await firstLoad;
    expect(component.getCharacterThumbnailDataUrl(character)).toBe('data:/project/images/main.png');
  });
});
