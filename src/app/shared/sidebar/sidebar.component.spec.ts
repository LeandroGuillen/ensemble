import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { SidebarComponent } from './sidebar.component';
import { ProjectService } from '../../core/services';
import { ElectronService } from '../../core/services/electron.service';
import { UpdateService, UpdateStatus } from '../../core/services/update.service';
import { NotificationService } from '../../core/services/notification.service';
import { CharacterEditDialogService } from '../../core/services/character-edit-dialog.service';
import { ThemeService } from '../../core/services/theme.service';
import { SkinService } from '../../core/services/skin.service';
import { CommandPaletteService } from '../command-palette/command-palette.service';
import { KeyboardShortcutsService } from '../keyboard-shortcuts-dialog/keyboard-shortcuts.service';

describe('SidebarComponent update control', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let status$: BehaviorSubject<UpdateStatus>;

  /** Pushes an update status and returns the rendered control. */
  const renderControl = (status: UpdateStatus): HTMLButtonElement => {
    status$.next(status);
    // The status is pushed outside Angular's knowledge, so mark the view
    // dirty before change detection to have the template pick it up.
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('button.update-control') as HTMLButtonElement;
  };

  beforeEach(async () => {
    // Render the expanded sidebar so any text label inside the control would be visible.
    localStorage.setItem('sidebar-collapsed', 'false');
    status$ = new BehaviorSubject<UpdateStatus>({ status: 'idle' });

    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        {
          provide: UpdateService,
          useValue: jasmine.createSpyObj<UpdateService>(
            'UpdateService',
            ['checkForUpdates', 'downloadUpdate', 'quitAndInstall'],
            { updateStatus$: status$.asObservable() }
          )
        },
        { provide: ProjectService, useValue: { currentProject$: of({ name: 'Test Project' }) } },
        { provide: ElectronService, useValue: { getVersion: () => Promise.resolve('1.21.17') } },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['showError']) },
        { provide: CharacterEditDialogService, useValue: jasmine.createSpyObj('CharacterEditDialogService', ['openCreateDraft']) },
        { provide: CommandPaletteService, useValue: jasmine.createSpyObj('CommandPaletteService', ['open']) },
        { provide: KeyboardShortcutsService, useValue: jasmine.createSpyObj('KeyboardShortcutsService', ['open']) },
        {
          provide: ThemeService,
          useValue: { getAvailableThemes: () => [], currentTheme$: of(null), setTheme: () => Promise.resolve() }
        },
        {
          provide: SkinService,
          useValue: { getAvailableSkins: () => [], currentSkin$: of({ id: 'classic', name: 'Classic' }), setSkin: () => Promise.resolve() }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('sidebar-collapsed');
  });

  it('renders idle as a static check-circle icon with no text label', () => {
    const button = renderControl({ status: 'idle' });

    expect(button.tagName).toBe('BUTTON');
    expect(button.querySelector('use')?.getAttribute('href')).toBe('#icon-circle-check');
    expect(button.getAttribute('aria-label')).toBe('Up to date. Check for updates');
    expect(button.getAttribute('title')).toBe('Up to date. Check for updates');
    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.querySelector('.update-pill-label')).toBeNull();
    expect(button.textContent?.trim() ?? '').toBe('');
  });

  it('renders not-available like idle: static check-circle, no text label', () => {
    const button = renderControl({ status: 'not-available' });

    expect(button.tagName).toBe('BUTTON');
    expect(button.querySelector('use')?.getAttribute('href')).toBe('#icon-circle-check');
    expect(button.getAttribute('aria-label')).toBe('Up to date. Check for updates');
    expect(button.getAttribute('title')).toBe('Up to date. Check for updates');
    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.querySelector('.update-pill-label')).toBeNull();
    expect(button.textContent?.trim() ?? '').toBe('');
  });

  it('renders checking as a static disabled hourglass marked aria-busy', () => {
    const button = renderControl({ status: 'checking' });

    expect(button.tagName).toBe('BUTTON');
    expect(button.querySelector('use')?.getAttribute('href')).toBe('#icon-hourglass');
    expect(button.getAttribute('aria-label')).toBe('Checking for updates');
    expect(button.getAttribute('title')).toBe('Checking for updates');
    expect(button.disabled).toBeTrue();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.update-pill-label')).toBeNull();
    expect(button.textContent?.trim() ?? '').toBe('');
  });

  it('renders available as a download icon with the version and no text label', () => {
    const button = renderControl({ status: 'available', version: '9.9.9' });

    expect(button.tagName).toBe('BUTTON');
    expect(button.querySelector('use')?.getAttribute('href')).toBe('#icon-download');
    expect(button.getAttribute('aria-label')).toBe('Download update v9.9.9');
    expect(button.getAttribute('title')).toBe('Download update v9.9.9');
    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.querySelector('.update-pill-label')).toBeNull();
    expect(button.textContent?.trim() ?? '').toBe('');
  });

  it('renders downloading as a disabled download icon with static determinate progress', () => {
    const button = renderControl({
      status: 'downloading',
      version: '9.9.9',
      progress: { percent: 42, transferred: 42, total: 100 }
    });

    expect(button.tagName).toBe('BUTTON');
    expect(button.querySelector('use')?.getAttribute('href')).toBe('#icon-download');
    expect(button.getAttribute('aria-label')).toBe('Downloading update 42%');
    expect(button.getAttribute('title')).toBe('Downloading update 42%');
    expect(button.disabled).toBeTrue();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.update-progress-bar')?.getAttribute('style')).toContain('width: 42%');
    expect(button.querySelector('.update-pill-label')).toBeNull();
    expect(button.textContent?.trim() ?? '').toBe('');
  });

  it('renders downloaded as a power icon with the version and no text label', () => {
    const button = renderControl({ status: 'downloaded', version: '9.9.9' });

    expect(button.tagName).toBe('BUTTON');
    expect(button.querySelector('use')?.getAttribute('href')).toBe('#icon-power');
    expect(button.getAttribute('aria-label')).toBe('Restart to apply update v9.9.9');
    expect(button.getAttribute('title')).toBe('Restart to apply update v9.9.9');
    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.querySelector('.update-pill-label')).toBeNull();
    expect(button.textContent?.trim() ?? '').toBe('');
  });

  it('renders error as an alert-triangle icon inviting another check', () => {
    const button = renderControl({ status: 'error' });

    expect(button.tagName).toBe('BUTTON');
    expect(button.querySelector('use')?.getAttribute('href')).toBe('#icon-alert-triangle');
    expect(button.getAttribute('aria-label')).toBe('Update failed. Click to check again');
    expect(button.getAttribute('title')).toBe('Update failed. Click to check again');
    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.querySelector('.update-pill-label')).toBeNull();
    expect(button.textContent?.trim() ?? '').toBe('');
  });

  it('omits the version from the tooltip when it is unknown', () => {
    expect(renderControl({ status: 'available' }).getAttribute('title')).toBe('Download update');
    expect(renderControl({ status: 'downloaded' }).getAttribute('title')).toBe('Restart to apply update');
  });

  it('updates the icon and tooltip when the status changes on the same control', () => {
    let button = renderControl({ status: 'available', version: '9.9.9' });
    expect(button.querySelector('use')?.getAttribute('href')).toBe('#icon-download');

    button = renderControl({ status: 'downloaded', version: '9.9.9' });
    expect(button.querySelector('use')?.getAttribute('href')).toBe('#icon-power');
    expect(button.getAttribute('aria-label')).toBe('Restart to apply update v9.9.9');
  });
});
