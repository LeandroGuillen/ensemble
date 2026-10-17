import { CharacterDetailComponent } from './character-detail.component';

describe('Character editor book picture previews', () => {
  it('keeps the latest book preview when a previous book finishes loading later', async () => {
    let finishFirst!: (value: string) => void;
    const component: any = Object.create(CharacterDetailComponent.prototype);
    Object.assign(component, {
      thumbnailPreviewRequest: 0, thumbnailPreviewUrls: new Map([['realistic', 'old-picture']]),
      currentProject: { path: '/project' }, characterStyles: [{ id: 'realistic', name: 'Realistic' }],
      thumbnailsMap: { realistic: 'images/main.png' },
      bookThumbnailsMap: { first: { realistic: 'images/first.png' } },
      cdr: { markForCheck: jasmine.createSpy() },
      electronService: { getImageAsDataUrl: (path: string) => path.endsWith('/first.png')
        ? new Promise<string>(resolve => { finishFirst = resolve; })
        : Promise.resolve('main-picture') },
    });
    const firstLoad = component.refreshThumbnailPreviews('first');
    expect(component.thumbnailPreviewUrls.size).toBe(0);
    await component.refreshThumbnailPreviews('second');
    expect(component.getStylePreviewUrl('realistic')).toBe('main-picture');
    finishFirst('late-first-book');
    await firstLoad;
    expect(component.getStylePreviewUrl('realistic')).toBe('main-picture');
  });
});
