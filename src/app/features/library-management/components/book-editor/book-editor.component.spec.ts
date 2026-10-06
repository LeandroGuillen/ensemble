import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BookEditorComponent } from './book-editor.component';
import { CharacterPickerService } from '../../../../core/services/character-picker.service';
import { CharacterService } from '../../../../core/services/character.service';
import { ModalService } from '../../../../core/services/modal.service';
import { ProjectService } from '../../../../core/services/project.service';

describe('Book editor layout', () => {
  let fixture: ComponentFixture<BookEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookEditorComponent],
      providers: [
        { provide: CharacterPickerService, useValue: { pick: async () => null } },
        { provide: CharacterService, useValue: { getCharacterById: () => undefined } },
        { provide: ProjectService, useValue: { getCurrentProject: () => null, getDefaultCharacterStyle: () => '' } },
        { provide: ModalService, useValue: { confirm: async () => false } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BookEditorComponent);
    fixture.componentRef.setInput('isVisible', true);
    fixture.componentRef.setInput('book', { id: 'book', name: 'Test book', color: '#3498db' });
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('fits the standard desktop form without scrolling', () => {
    if (window.innerWidth < 768 || window.innerHeight < 600) {
      pending('Requires a desktop viewport of at least 768 × 600.');
      return;
    }
    const page = fixture.nativeElement.querySelector('.book-editor-page') as HTMLElement;
    const content = fixture.nativeElement.querySelector('.page-content') as HTMLElement;
    page.style.transition = 'none';
    expect(content.scrollHeight).toBeLessThanOrEqual(content.clientHeight + 1);
    expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth + 1);
    const bounds = page.getBoundingClientRect();
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
  });

  it('keeps all actions visible when content scrolls on a short screen', () => {
    const page = fixture.nativeElement.querySelector('.book-editor-page') as HTMLElement;
    const content = fixture.nativeElement.querySelector('.page-content') as HTMLElement;
    const header = fixture.nativeElement.querySelector('.page-header') as HTMLElement;
    page.style.maxHeight = '300px';
    page.style.transition = 'none';
    const actions = Array.from(header.querySelectorAll('button'));
    const before = actions.map(button => button.getBoundingClientRect().top);
    expect(content.scrollHeight).toBeGreaterThan(content.clientHeight);
    content.scrollTop = content.scrollHeight;
    expect(content.scrollTop).toBeGreaterThan(0);
    actions.forEach((button, index) => {
      const bounds = button.getBoundingClientRect();
      expect(bounds.top).toBe(before[index]);
      expect(bounds.bottom).toBeLessThanOrEqual(content.getBoundingClientRect().top);
    });
    expect(page.scrollHeight).toBeLessThanOrEqual(page.clientHeight + 2);
  });

  it('submits the form from the top action bar', () => {
    const save = spyOn(fixture.componentInstance.save, 'emit');
    fixture.nativeElement.querySelector('.page-header .btn-primary').click();
    expect(save).toHaveBeenCalledWith(jasmine.objectContaining({ name: 'Test book' }));
  });
});
