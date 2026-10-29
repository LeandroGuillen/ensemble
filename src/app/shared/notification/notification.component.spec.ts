import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NotificationComponent } from './notification.component';
import { NotificationService } from '../../core/services/notification.service';

describe('NotificationComponent action / showUndo', () => {
  let fixture: ComponentFixture<NotificationComponent>;
  let component: NotificationComponent;
  let notifications: NotificationService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotificationComponent],
      providers: [NotificationService],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationComponent);
    component = fixture.componentInstance;
    notifications = TestBed.inject(NotificationService);
    fixture.detectChanges();
  });

  function showAndDetect(
    message: string,
    onUndo: () => void | Promise<void>,
    durationMs: number
  ): void {
    // Cast so this spec still *runs* on 6a214e3 (pre-showUndo) and fails by assertion.
    expect(typeof (notifications as any).showUndo).toBe('function');
    (notifications as any).showUndo(message, onUndo, durationMs);
    // Flush the Subject emission outside the current CD cycle.
    tick(0);
    fixture.detectChanges();
  }

  it('showUndo renders a toast with an Undo button', fakeAsync(() => {
    showAndDetect('Character "Ada" moved to Trash.', () => undefined, 15000);

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Character "Ada" moved to Trash.');
    const actionBtn = el.querySelector('button.notification-action') as HTMLButtonElement;
    expect(actionBtn).toBeTruthy();
    expect(actionBtn.textContent?.trim()).toBe('Undo');
  }));

  it('one click or a fast double click runs the action exactly once and dismisses', fakeAsync(() => {
    let runs = 0;
    showAndDetect(
      'Draft "X" moved to Trash.',
      () => {
        runs += 1;
      },
      15000
    );

    const actionBtn = fixture.nativeElement.querySelector(
      'button.notification-action'
    ) as HTMLButtonElement;
    actionBtn.click();
    actionBtn.click();
    tick();
    fixture.detectChanges();

    expect(runs).toBe(1);
    expect(fixture.nativeElement.querySelector('.notification')).toBeNull();
  }));

  it('auto-dismisses after durationMs', fakeAsync(() => {
    showAndDetect('Location "Harbour" moved to Trash.', () => undefined, 1000);
    expect(fixture.nativeElement.querySelector('.notification')).toBeTruthy();

    tick(1000);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.notification')).toBeNull();
  }));

  it('supports sticky errors with duration 0', fakeAsync(() => {
    notifications.showError('Sticky failure', 0);
    tick(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.notification-error')).toBeTruthy();

    tick(60_000);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.notification-error')).toBeTruthy();
  }));

  it('dismissAll clears every toast', fakeAsync(() => {
    showAndDetect('A', () => undefined, 15000);
    showAndDetect('B', () => undefined, 15000);
    expect(component.notifications.length).toBe(2);

    expect(typeof (notifications as any).dismissAll).toBe('function');
    (notifications as any).dismissAll();
    tick(0);
    fixture.detectChanges();
    expect(component.notifications.length).toBe(0);
  }));
});
