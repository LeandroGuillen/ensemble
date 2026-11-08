import { TestBed } from '@angular/core/testing';
import { CharacterGridViewComponent } from './character-grid-view.component';
import { MetadataHelperService } from '../../../../core/services/metadata-helper.service';
import { WikiLinkTargetsService } from '../../../../core/services/wiki-link-targets.service';
import { buildWikiLinkTargets } from '../../../../core/utils/wiki-links.utils';
import { of } from 'rxjs';

describe('CharacterGridViewComponent card actions', () => {
  const setup = async () => {
    await TestBed.configureTestingModule({
      imports: [CharacterGridViewComponent],
      providers: [{
        provide: MetadataHelperService,
        useValue: { getCategoryName: () => 'Main Character', getCategoryColor: () => '#3b82f6' },
      }],
    }).compileComponents();
    const fixture = TestBed.createComponent(CharacterGridViewComponent);
    fixture.componentRef.setInput('characters', [
      { id: 'mara', name: 'Mara Vell', tags: [], category: 'main' },
    ]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    return { fixture, root, component: fixture.componentInstance };
  };

  it('has no interactive wrapper around its buttons (no nested interactive content)', async () => {
    const { root } = await setup();
    const card = root.querySelector('.character-card') as HTMLElement;
    expect(card.getAttribute('role')).toBeNull();
    expect(card.hasAttribute('tabindex')).toBeFalse();
    const buttons = Array.from(card.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Edit Mara Vell', 'Delete Mara Vell']);
    expect(buttons.every(b => b.type === 'button')).toBeTrue();
  });

  it('leaves Enter and Space on Edit/Delete to the native button (nothing calls preventDefault)', async () => {
    const { root, component } = await setup();
    const opened: string[] = [];
    component.characterClick.subscribe(c => opened.push(c.id));
    for (const selector of ['.edit-btn', '.delete-btn']) {
      const button = root.querySelector(selector) as HTMLButtonElement;
      for (const key of ['Enter', ' ']) {
        const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        const up = new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true });
        button.dispatchEvent(down);
        button.dispatchEvent(up);
        expect(down.defaultPrevented).withContext(`${selector} ${JSON.stringify(key)} keydown`).toBeFalse();
        expect(up.defaultPrevented).withContext(`${selector} ${JSON.stringify(key)} keyup`).toBeFalse();
      }
    }
    // Key events alone never open the card from a child button.
    expect(opened).toEqual([]);
  });

  it('Edit opens the character once; Delete asks the list (and never opens the editor)', async () => {
    const { root, component } = await setup();
    const opened: string[] = [];
    const deleted: string[] = [];
    component.characterClick.subscribe(c => opened.push(c.id));
    component.characterDelete.subscribe(e => { e.event.stopPropagation(); deleted.push(e.character.id); });

    (root.querySelector('.edit-btn') as HTMLButtonElement).click();
    expect(opened).toEqual(['mara']);

    (root.querySelector('.delete-btn') as HTMLButtonElement).click();
    expect(deleted).toEqual(['mara']);
    expect(opened).toEqual(['mara']);
  });

  it('card description shows a [[C#]] link as the C# record it opens', async () => {
    TestBed.configureTestingModule({
      providers: [{
        provide: WikiLinkTargetsService,
        useValue: {
          recordName$: () => of(buildWikiLinkTargets([{
            folder: 'characters', route: 'character', singular: 'Character',
            targets: [{ id: 'c', name: 'C#', relativePath: 'c/c.md' }, { id: 'u', name: 'Unit#7', relativePath: 'u/u.md' }],
          }]).recordName),
        },
      }],
    });
    const { fixture, root } = await setup();
    fixture.componentRef.setInput('characters', [
      { id: 'mara', name: 'Mara Vell', tags: [], category: 'main', content: 'Writes [[C#]] for [[Unit#7]].' },
    ]);
    fixture.detectChanges();
    expect(root.querySelector('.character-description')?.textContent?.trim()).toBe('Writes C# for Unit#7.');
  });
});
