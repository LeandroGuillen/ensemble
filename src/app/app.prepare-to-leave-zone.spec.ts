import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { of } from 'rxjs';
import { AppComponent } from './app.component';
import { BookPlanService } from './core/services/book-plan.service';
import { ModalService } from './core/services/modal.service';
import {
  AddConceptCommandService,
  AddNameCommandService,
  CharacterCommandService,
  CharacterService,
  ElectronService,
  FileWatcherService,
  LocationCommandService,
  LocationService,
  LoggingService,
  ProjectService,
  SkinService,
  ThemeService,
  ZoomService,
} from './core/services';
import { HouseCommandService } from './core/services/house-command.service';
import { HouseService } from './core/services/house.service';
import { CommandPaletteService } from './shared/command-palette/command-palette.service';
import { ConfirmationDialogComponent } from './shared/confirmation-dialog/confirmation-dialog.component';
import { KeyboardShortcutsService } from './shared/keyboard-shortcuts-dialog/keyboard-shortcuts.service';

/**
 * Regression: ipcRenderer.on fires outside NgZone. Without zone.run the
 * conflict dialog state is never change-detected until a click/key.
 */
describe('AppComponent prepare-to-leave zone', () => {
  let fixture: ComponentFixture<AppComponent>;
  let component: AppComponent;
  let ngZone: NgZone;
  let modal: ModalService;
  let electron: jasmine.SpyObj<ElectronService>;

  beforeEach(async () => {
    electron = jasmine.createSpyObj('ElectronService', [
      'getVersion',
      'onPrepareToLeaveRequest',
      'removePrepareToLeaveRequestListener',
      'replyPrepareToLeaveAck',
      'replyPrepareToLeaveResult',
    ]);
    electron.getVersion.and.resolveTo('test');

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        ModalService,
        { provide: ElectronService, useValue: electron },
        {
          provide: ProjectService,
          useValue: {
            getMostRecentProject: () => null,
            currentProject$: of(null),
            getLastRoute: () => null,
            saveLastRoute: () => undefined,
          },
        },
        {
          provide: Router,
          useValue: {
            events: of(new NavigationEnd(1, '/', '/')),
            navigate: jasmine.createSpy(),
          },
        },
        {
          provide: CommandPaletteService,
          useValue: { open: () => undefined, replaceGroup: () => undefined },
        },
        { provide: KeyboardShortcutsService, useValue: { open: () => undefined } },
        { provide: Title, useValue: { setTitle: () => undefined } },
        {
          provide: ThemeService,
          useValue: { initialize: () => undefined, getAvailableThemes: () => [] },
        },
        {
          provide: SkinService,
          useValue: { initialize: () => undefined, getAvailableSkins: () => [] },
        },
        {
          provide: LoggingService,
          useValue: { error: jasmine.createSpy('error'), log: () => undefined },
        },
        { provide: ZoomService, useValue: {} },
        { provide: AddNameCommandService, useValue: { register: () => undefined } },
        { provide: AddConceptCommandService, useValue: { register: () => undefined } },
        {
          provide: CharacterCommandService,
          useValue: { activate: () => undefined, deactivate: () => undefined },
        },
        {
          provide: CharacterService,
          useValue: {
            loadCharacters: () => Promise.resolve(),
            getCharacterById: () => null,
          },
        },
        {
          provide: LocationCommandService,
          useValue: { activate: () => undefined, deactivate: () => undefined },
        },
        { provide: LocationService, useValue: { loadLocations: () => Promise.resolve() } },
        { provide: HouseService, useValue: { loadHouses: () => Promise.resolve() } },
        {
          provide: HouseCommandService,
          useValue: { activate: () => undefined, deactivate: () => undefined },
        },
        {
          provide: FileWatcherService,
          useValue: {
            startWatching: () => Promise.resolve(),
            stopWatching: () => Promise.resolve(),
          },
        },
        {
          provide: BookPlanService,
          useValue: { prepareToLeave: () => Promise.resolve(true) },
        },
      ],
    })
      .overrideComponent(AppComponent, {
        set: {
          imports: [ConfirmationDialogComponent],
          template: `
            <app-confirmation-dialog
              [visible]="confirmationVisible"
              [title]="currentConfirmation?.title || 'Confirm'"
              [message]="currentConfirmation?.message || ''"
              [confirmText]="currentConfirmation?.confirmText || 'Confirm'"
              [cancelText]="currentConfirmation?.cancelText || 'Cancel'"
              [secondaryText]="currentConfirmation?.secondaryText || ''"
              (confirm)="onConfirmationConfirm()"
              (secondary)="onConfirmationSecondary()"
              (cancel)="onConfirmationCancel()"
            ></app-confirmation-dialog>
          `,
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    ngZone = TestBed.inject(NgZone);
    modal = TestBed.inject(ModalService);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('routes the IPC prepare-to-leave callback through NgZone.run', () => {
    const runSpy = spyOn(ngZone, 'run').and.callThrough();
    ngZone.runOutsideAngular(() => {
      (component as any).prepareToLeaveHandler();
    });
    expect(runSpy).toHaveBeenCalled();
  });

  it('updates dialog state via NgZone.run when choose() is invoked outside the zone', async () => {
    const runSpy = spyOn(ngZone, 'run').and.callThrough();

    ngZone.runOutsideAngular(() => {
      void modal.choose(
        'This plan changed on disk while you had unsaved edits. What do you want to do with your version?',
        'Plan changed on disk',
        {
          confirmText: 'Keep mine',
          secondaryText: 'Reload from disk',
          cancelText: 'Cancel',
        }
      );
    });

    expect(runSpy).toHaveBeenCalled();
    expect(component.confirmationVisible).toBeTrue();
    expect(component.currentConfirmation?.title).toBe('Plan changed on disk');
    expect(component.currentConfirmation?.confirmText).toBe('Keep mine');
    expect(component.currentConfirmation?.secondaryText).toBe('Reload from disk');

    // Dismiss so the pending choose() promise settles.
    component.onConfirmationCancel();
    await new Promise((r) => setTimeout(r, 20));
  });
});
