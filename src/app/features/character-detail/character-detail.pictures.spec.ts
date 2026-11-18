import { CharacterDetailComponent } from './character-detail.component';

describe('Character editor style selection', () => {
  it('opens the picker for each missing image and selects its style only after a choice', async () => {
    const component: any = Object.create(CharacterDetailComponent.prototype);
    const open = jasmine.createSpy().and.resolveTo(undefined);
    const getFileStats = jasmine.createSpy().and.callFake(async (path: string) =>
      path === '/project/images/main.png'
        ? { success: true, stats: { isFile: true } }
        : { success: false }
    );
    Object.assign(component, {
      styleSelectionRequest: 0,
      selectedStyleId: 'realistic',
      activeContentTab: 'first',
      currentProject: { path: '/project' },
      thumbnailsMap: { realistic: 'images/main.png', ink: 'images/deleted.png' },
      bookThumbnailsMap: { first: { watercolor: 'images/missing.png' } },
      writeProtection: { readOnlyPath: null },
      imagePickerService: { open, close: jasmine.createSpy(), snapshot: {} },
      electronService: { getFileStats },
      getCharacterProjectRelativeDirectory: () => 'characters/example',
      refreshThumbnailPreviews: jasmine.createSpy().and.resolveTo(undefined),
      characterForm: { markAsDirty: jasmine.createSpy() },
      cdr: { markForCheck: jasmine.createSpy() },
    });

    for (const styleId of ['sketch', 'ink', 'watercolor']) {
      open.calls.reset();
      await component.selectStyle(styleId);
      expect(open).toHaveBeenCalledTimes(1);
      expect(component.showImagePickerDialog).toBeTrue();
      expect(component.pickerTargetStyleId).toBe(styleId);
      expect(component.selectedStyleId).toBe('realistic');
      component.closeImagePicker();
      expect(component.selectedStyleId).toBe('realistic');
    }
    expect(getFileStats).toHaveBeenCalledWith('/project/images/deleted.png');
    expect(getFileStats).toHaveBeenCalledWith('/project/images/missing.png');
    expect(component.bookThumbnailsMap).toEqual({ first: { watercolor: 'images/missing.png' } });

    await component.selectStyle('sketch');
    component.onImageSelected({ relativePath: 'images/sketch.png' });
    expect(component.selectedStyleId).toBe('sketch');
    expect(component.bookThumbnailsMap.first.sketch).toBe('[[images/sketch.png]]');

    open.calls.reset();
    await component.selectStyle('realistic');
    expect(component.selectedStyleId).toBe('realistic');
    expect(open).not.toHaveBeenCalled();
  });
});

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
