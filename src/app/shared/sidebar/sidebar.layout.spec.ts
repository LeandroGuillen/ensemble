import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { SidebarComponent } from './sidebar.component';
import { ProjectService } from '../../core/services';
import { ElectronService } from '../../core/services/electron.service';
import { UpdateService } from '../../core/services/update.service';
import { NotificationService } from '../../core/services/notification.service';
import { CharacterEditDialogService } from '../../core/services/character-edit-dialog.service';
import { ThemeService } from '../../core/services/theme.service';
import { SkinService } from '../../core/services/skin.service';
import { CommandPaletteService } from '../command-palette/command-palette.service';
import { KeyboardShortcutsService } from '../keyboard-shortcuts-dialog/keyboard-shortcuts.service';

describe('SidebarComponent adaptive layout and current section', () => {
  let width = 1440;

  const create = () => {
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    return fixture;
  };

  const resizeTo = (component: SidebarComponent, w: number) => {
    width = w;
    component.onWindowResize();
  };

  beforeEach(async () => {
    localStorage.removeItem('sidebar-collapsed');
    width = 1440;
    spyOnProperty(window, 'innerWidth', 'get').and.callFake(() => width);

    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        {
          provide: UpdateService,
          useValue: { updateStatus$: of({ status: 'idle' }), checkForUpdates: () => Promise.resolve({ success: true }) },
        },
        { provide: ProjectService, useValue: { currentProject$: of({ name: 'Test Project' }) } },
        { provide: ElectronService, useValue: { getVersion: () => Promise.resolve('1.0.0') } },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['showError']) },
        { provide: CharacterEditDialogService, useValue: jasmine.createSpyObj('CharacterEditDialogService', ['openCreateDraft']) },
        { provide: CommandPaletteService, useValue: jasmine.createSpyObj('CommandPaletteService', ['open']) },
        { provide: KeyboardShortcutsService, useValue: jasmine.createSpyObj('KeyboardShortcutsService', ['open']) },
        { provide: ThemeService, useValue: { getAvailableThemes: () => [], currentTheme$: of(null), setTheme: () => Promise.resolve() } },
        { provide: SkinService, useValue: { getAvailableSkins: () => [], currentSkin$: of({ id: 'classic', name: 'Classic' }), setSkin: () => Promise.resolve() } },
      ],
    }).compileComponents();
  });

  afterEach(() => localStorage.removeItem('sidebar-collapsed'));

  it('without a saved choice follows the window width on every resize, not only at start-up', () => {
    width = 1200;
    const c = create().componentInstance;
    expect(c.isCollapsed).toBeTrue();

    resizeTo(c, 1440);
    expect(c.isCollapsed).toBeFalse();

    resizeTo(c, 1200);
    expect(c.isCollapsed).toBeTrue();
  });

  it('keeps an explicit choice in wide windows and saves it', () => {
    const c = create().componentInstance;
    expect(c.isCollapsed).toBeFalse();

    c.toggleCollapse();
    expect(c.isCollapsed).toBeTrue();
    expect(localStorage.getItem('sidebar-collapsed')).toBe('true');

    resizeTo(c, 1600);
    expect(c.isCollapsed).toBeTrue();
  });

  it('folds to icons in narrow windows and restores the explicit choice when room returns', () => {
    localStorage.setItem('sidebar-collapsed', 'false');
    width = 1300;
    const c = create().componentInstance;
    expect(c.isCollapsed).toBeFalse();

    resizeTo(c, 900);
    expect(c.isCollapsed).toBeTrue();
    expect(localStorage.getItem('sidebar-collapsed')).toBe('false');

    resizeTo(c, 1200);
    expect(c.isCollapsed).toBeFalse();
  });

  it('opens labels as a temporary overlay in narrow windows without saving, and closes on Escape', () => {
    width = 900;
    const fixture = create();
    const c = fixture.componentInstance;

    c.toggleCollapse();
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(c.isCollapsed).toBeFalse();
    expect(c.isOverlay).toBeTrue();
    expect(localStorage.getItem('sidebar-collapsed')).toBeNull();
    expect(fixture.nativeElement.querySelector('aside.sidebar.overlay')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.sidebar-rail-spacer')).not.toBeNull();

    c.onKeydown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(c.isOverlay).toBeFalse();
    expect(c.isCollapsed).toBeTrue();
  });

  it('marks the owning section on detail and create routes', () => {
    const c = create().componentInstance;
    const cases: Array<[string, string, 'page' | 'location']> = [
      ['/characters', '/characters', 'page'],
      ['/character/abc123', '/characters', 'location'],
      ['/character', '/characters', 'location'],
      ['/character-draft/x', '/characters', 'location'],
      ['/house/house-vell', '/houses', 'location'],
      ['/location/l1', '/locations', 'location'],
      ['/book/lc2?line=4', '/library', 'location'],
      ['/cast/c1/pinboard', '/casts', 'location'],
      ['/houses', '/houses', 'page'],
    ];
    for (const [url, route, expected] of cases) {
      c.currentRoute = url;
      expect(c.isActive(route)).withContext(url).toBeTrue();
      expect(c.ariaCurrent(route)).withContext(url).toBe(expected);
    }
    c.currentRoute = '/concepts';
    expect(c.isActive('/characters')).toBeFalse();
    expect(c.ariaCurrent('/characters')).toBeNull();
  });
});
