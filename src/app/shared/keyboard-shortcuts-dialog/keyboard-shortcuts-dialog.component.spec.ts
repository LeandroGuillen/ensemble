import { ComponentFixture, TestBed } from '@angular/core/testing';
import { KeyboardShortcutsDialogComponent } from './keyboard-shortcuts-dialog.component';
import { KeyboardShortcutsService } from './keyboard-shortcuts.service';

describe('KeyboardShortcutsDialogComponent', () => {
  let fixture: ComponentFixture<KeyboardShortcutsDialogComponent>;
  let service: KeyboardShortcutsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KeyboardShortcutsDialogComponent],
    }).compileComponents();

    service = TestBed.inject(KeyboardShortcutsService);
    fixture = TestBed.createComponent(KeyboardShortcutsDialogComponent);
  });

  it('renders book plan Alt+PgUp/PgDn and plan-search shortcuts when open', () => {
    // Open before the first CD so ngOnInit's subscription loads shortcuts in one pass
    // (avoids ExpressionChangedAfterItHasBeenCheckedError).
    service.open();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain('Book Plan');
    expect(text).toContain('Previous / next chapter');
    expect(text).toContain('Alt');
    expect(text).toMatch(/PgUp\/PgDn|PGUP\/PGDN/i);

    expect(text).toContain('Plan search');
    expect(text).toContain('Move selection by 10 results');
    expect(text).toContain('Next / previous result group');
    expect(text).toMatch(/Tab \/ Shift\+Tab/i);
  });
});
