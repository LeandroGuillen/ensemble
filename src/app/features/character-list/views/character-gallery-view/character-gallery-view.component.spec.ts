import { TestBed } from '@angular/core/testing';
import { CharacterGalleryViewComponent } from './character-gallery-view.component';

describe('Gallery PoV indicators', () => {
  it('keeps stars visible at every card size while truncating long names', async () => {
    await TestBed.configureTestingModule({ imports: [CharacterGalleryViewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(CharacterGalleryViewComponent);
    fixture.componentRef.setInput('characters', [
      { id: 'long', name: 'Dessir Galsea with a very long character name', tags: [] },
      { id: 'short', name: 'Reól Bardez', tags: [] },
    ]);
    fixture.componentRef.setInput('povCharacterIds', new Set(['long', 'short']));

    for (const [size, width] of [['small', 100], ['medium', 160], ['big', 240]] as const) {
      fixture.componentRef.setInput('thumbnailSize', size);
      fixture.detectChanges();
      const grid = fixture.nativeElement.querySelector('.character-gallery-view') as HTMLElement;
      grid.style.width = `${width}px`;
      grid.style.gridTemplateColumns = 'minmax(0, 1fr)';
      const names = Array.from(fixture.nativeElement.querySelectorAll('.gallery-name')) as HTMLElement[];
      expect(names.length).toBe(2);
      for (const name of names) {
        const star = name.querySelector('.pov-star')!.getBoundingClientRect();
        const bounds = name.getBoundingClientRect();
        expect(star.width).toBeGreaterThan(0);
        expect(star.left).toBeGreaterThanOrEqual(bounds.left);
        expect(star.right).toBeLessThanOrEqual(bounds.right);
        expect(star.top).toBeGreaterThanOrEqual(bounds.top);
        expect(star.bottom).toBeLessThanOrEqual(bounds.bottom);
      }
      const label = names[0].querySelector('.character-name-text') as HTMLElement;
      expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
    }
  });
});
