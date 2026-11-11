import { CharacterRenderScheduler } from './character-render-scheduler.service';
import { By } from '@angular/platform-browser';
import { CdkDrag } from '@angular/cdk/drag-drop';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Character } from '../../../core/interfaces';
import { MetadataHelperService } from '../../../core/services/metadata-helper.service';
import { PromptService } from '../../../core/services/prompt.service';
import { CharacterGridViewComponent } from './character-grid-view/character-grid-view.component';
import { CharacterListViewComponent } from './character-list-view/character-list-view.component';

const characters = (): Character[] => Array.from({ length: 2000 }, (_, i) => ({
  id: `person-${i}`, name: `Person ${i}`, category: 'main', tags: [], books: ['a', 'b'],
  content: 'A character with a long biography. '.repeat(80), prompts: [],
  created: new Date(), modified: new Date(), relativePath: `${i}/${i}.md`, filePath: `/throwaway/${i}/${i}.md`,
}));

for (const view of [CharacterGridViewComponent, CharacterListViewComponent]) {
  describe(`${view.name} large-project rendering`, () => {
    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [view],
        providers: [provideRouter([]),
          { provide: MetadataHelperService, useValue: { getCategoryName: () => 'Main', getCategoryColor: () => '#123456' } },
          { provide: PromptService, useValue: { prompts$: of([]) } },
        ],
      }).compileComponents();
    });

    it('also bounds initial rendering across many small groups', fakeAsync(() => {
      const records = characters();
      const fixtures = records.slice(0, 60).map(record => {
        const fixture = TestBed.createComponent(view as typeof CharacterGridViewComponent);
        fixture.componentRef.setInput('characters', [record]);
        fixture.detectChanges();
        return fixture;
      });
      const count = () => fixtures.reduce((total, fixture) => total + fixture.nativeElement.querySelectorAll('.character-item').length, 0);
      expect(count()).toBeLessThanOrEqual(24);
      tick(1000);
      expect(count()).toBe(60);
      fixtures.forEach(fixture => fixture.destroy());
    }));

    it('shares a render budget between groups and pauses while dragging', fakeAsync(() => {
      const fixtures = [0, 1].map(offset => {
        const fixture = TestBed.createComponent(view as typeof CharacterGridViewComponent);
        fixture.componentRef.setInput('characters', characters().slice(offset * 60, offset * 60 + 60));
        fixture.detectChanges();
        return fixture;
      });
      const count = () => fixtures.reduce((total, fixture) => total + fixture.nativeElement.querySelectorAll('.character-item').length, 0);
      const scheduler = TestBed.inject(CharacterRenderScheduler);
      tick(16);
      expect(count()).toBeGreaterThan(0);
      expect(count()).toBeLessThanOrEqual(12);
      scheduler.pause();
      const pausedCount = count();
      tick(100);
      expect(count()).toBe(pausedCount);
      scheduler.resume();
      tick(1000);
      expect(count()).toBe(120);
      fixtures.forEach(fixture => fixture.destroy());
    }));

    it('keeps retained cards, nav occurrences and drag data correct after sorting, filtering and an edit', fakeAsync(() => {
      const fixture = TestBed.createComponent(view as typeof CharacterGridViewComponent);
      const records = characters().slice(0, 60);
      fixture.componentRef.setInput('characters', records);
      fixture.componentRef.setInput('navIndexOffset', 100);
      fixture.componentRef.setInput('dndEnabled', true);
      fixture.detectChanges();
      tick(16); // Change the data while most cards are still pending.
      const firstCard = fixture.nativeElement.querySelector('.character-item');
      const edited = { ...records[0], name: 'Edited while rendering' };
      const next = [records[59], edited, records[1]];
      fixture.componentRef.setInput('characters', next);
      fixture.componentRef.setInput('selectedNavIndex', 101);
      fixture.detectChanges();
      tick(1000);
      const cards: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.character-item'));
      expect(cards.map(card => card.dataset['characterId'])).toEqual(next.map(character => character.id));
      expect(cards.map(card => card.dataset['navIndex'])).toEqual(['100', '101', '102']);
      expect(cards[1]).toBe(firstCard);
      expect(cards[1].textContent).toContain(edited.name);
      expect(cards[1].classList.contains('selected')).toBeTrue();
      const drags = fixture.debugElement.queryAll(By.directive(CdkDrag)).map(element => element.injector.get(CdkDrag));
      expect(drags.map(drag => drag.data)).toEqual(next);
      expect(drags.every(drag => !drag.disabled)).toBeTrue();
      const open = spyOn(fixture.componentInstance.characterClick, 'emit');
      cards[1].click();
      expect(open).toHaveBeenCalledWith(edited);
      fixture.destroy();
    }));

    it('cancels pending cards when the route is destroyed', fakeAsync(() => {
      const fixture = TestBed.createComponent(view as typeof CharacterGridViewComponent);
      fixture.componentRef.setInput('characters', characters());
      fixture.detectChanges();
      const rendered = spyOn(TestBed.inject(CharacterRenderScheduler).rendered$, 'next');
      fixture.destroy();
      tick(5000);
      expect(rendered).not.toHaveBeenCalled();
    }));

    it('yields before creating all 2,000 cards and their CDK drags', () => {
      const fixture = TestBed.createComponent(view as typeof CharacterGridViewComponent);
      fixture.componentRef.setInput('characters', characters());
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.character-item').length).toBeLessThanOrEqual(24);
      fixture.destroy();
    });
  });
}
