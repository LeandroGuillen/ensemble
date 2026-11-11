import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, BehaviorSubject } from 'rxjs';
import { Router } from '@angular/router';
import { TextSearchComponent } from './text-search.component';
import { TextSearchService } from '../../core/services/text-search.service';
import { ProjectService } from '../../core/services/project.service';
import { TextSearchIndex } from '../../core/utils/text-search.utils';

describe('TextSearchComponent', () => {
  let fixture: ComponentFixture<TextSearchComponent>;
  let index: TextSearchIndex;
  let changes: Subject<void>;
  let navigate: jasmine.Spy;
  let project: object | null;
  beforeEach(async () => {
    project = {};
    index = new TextSearchIndex();
    index.replace([
      { id: 'c', type: 'Characters', title: 'Mara', text: 'José <script>alert(1)</script>',
        route: ['/character', 'c'], book: 'Winter', queryParams: { book: 'b' } },
      { id: 'l', type: 'Locations', title: 'Harbor', text: 'José arrived here.', route: ['/location', 'l'] },
    ]);
    changes = new Subject();
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    await TestBed.configureTestingModule({ imports: [TextSearchComponent], providers: [
      { provide: TextSearchService, useValue: { index, changed$: changes, loading$: new BehaviorSubject(false),
        error$: new BehaviorSubject(''), rebuild: async () => {} } },
      { provide: ProjectService, useValue: { getCurrentProject: () => project } },
      { provide: Router, useValue: { navigate } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(TextSearchComponent);
    fixture.detectChanges();
  });

  it('opens with Ctrl+Shift+F, groups results, shows the book and highlights original accented text safely', async () => {
    const shortcut = new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, cancelable: true });
    document.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBeTrue();
    expect(fixture.componentInstance.isOpen).toBeTrue();
    fixture.componentInstance.query = 'jose';
    fixture.componentInstance.search();
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect([...element.querySelectorAll('h4')].map(h => h.textContent)).toEqual(['Characters', 'Locations']);
    await fixture.whenStable();
    expect(element.querySelector('mark')?.textContent).toBe('José');
    expect(element.querySelector('.book')?.textContent).toContain('Winter');
    expect(element.querySelector('script')).toBeNull();
    expect(element.textContent).toContain('<script>');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(fixture.componentInstance.isOpen).toBeFalse();
  });

  it('updates visible results when the index changes and opens a matching book page', async () => {
    fixture.componentInstance.open();
    fixture.componentInstance.query = 'jose';
    fixture.componentInstance.search();
    const result = fixture.componentInstance.groups[0].results[0];
    await fixture.componentInstance.select(result);
    expect(navigate).toHaveBeenCalledWith(['/character', 'c'], { queryParams: { book: 'b' } });
    expect(fixture.componentInstance.isOpen).toBeFalse();
    index.replace([]); changes.next();
    expect(fixture.componentInstance.count).toBe(0);
  });

  it('ignores the shortcut without a project', () => {
    project = null;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true }));
    expect(fixture.componentInstance.isOpen).toBeFalse();
  });
});
