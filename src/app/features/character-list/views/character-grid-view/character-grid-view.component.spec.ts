import { TestBed } from '@angular/core/testing';
import { CharacterGridViewComponent } from './character-grid-view.component';
import { MetadataHelperService } from '../../../../core/services/metadata-helper.service';
import { Character } from '../../../../core/interfaces';

describe('Character card keyboard boundaries', () => {
  it('preserves native child activation while card activation emits only once', async () => {
    await TestBed.configureTestingModule({
      imports: [CharacterGridViewComponent],
      providers: [{ provide: MetadataHelperService, useValue: { getCategoryName: () => 'Main', getCategoryColor: () => '#aaa', getCharacterTagsInOrder: () => [] } }]
    }).compileComponents();
    const fixture = TestBed.createComponent(CharacterGridViewComponent);
    fixture.componentRef.setInput('characters', [{ id: 'a', name: 'A', tags: [], content: '' } as unknown as Character]);
    fixture.detectChanges();
    const open = spyOn(fixture.componentInstance.characterClick, 'emit');
    const remove = spyOn(fixture.componentInstance.characterDelete, 'emit');
    const card = fixture.nativeElement.querySelector('.character-card');
    const button = card.querySelector('.delete-btn');
    for (const key of ['Enter', ' ']) {
      const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      button.dispatchEvent(down);
      expect(down.defaultPrevented).toBeFalse();
      button.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      expect(open).not.toHaveBeenCalled();
    }
    button.click();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
