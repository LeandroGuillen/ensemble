import { TestBed } from '@angular/core/testing';
import { Location as AngularLocation } from '@angular/common';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { LocationDetailComponent } from './location-detail.component';
import { MetadataService, LocationService, ProjectService, LoggingService, NotificationService, ModalService, ImagePickerService, ElectronService } from '../../core/services';
import { WikiLinkRenameService } from '../../core/services/wiki-link-rename.service';
import { WikiLinkTargetsService } from '../../core/services/wiki-link-targets.service';
import { ProjectWriteProtectionService } from '../../core/services/project-write-protection.service';
import { BacklinkService } from '../../core/services/backlink.service';

describe('Location sidebar editing', () => {
  it('commits a name on blur, keeps help in popups, and leaves empty backlinks invisible', async () => {
    const location = { id: 'a', name: 'Harbor', aliases: [], content: '', books: [], type: 'settlement' };
    const update = jasmine.createSpy().and.callFake(async (_id, payload) => ({ ...location, ...payload }));
    TestBed.configureTestingModule({
      imports: [LocationDetailComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'a' })), queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigate: jasmine.createSpy().and.resolveTo(true) } },
        { provide: AngularLocation, useValue: { back: () => {} } },
        { provide: LocationService, useValue: { loadLocations: async () => {}, getLocationById: () => location, updateLocation: update } },
        { provide: ProjectService, useValue: { getCurrentProject: () => ({ path: '/sidebar', metadata: { settings: {} } }) } },
        { provide: MetadataService, useValue: { metadata$: of({ books: [] }) } },
        { provide: LoggingService, useValue: { error: () => {} } },
        { provide: NotificationService, useValue: { showError: () => {}, showSuccess: () => {} } },
        { provide: ModalService, useValue: { confirm: async () => false } },
        { provide: WikiLinkRenameService, useValue: { run: (_old: unknown, _name: string, _type: string, save: () => Promise<unknown>) => save() } },
        { provide: WikiLinkTargetsService, useValue: { targets$: () => of({ resolve: () => null, suggestions: [] }) } },
        { provide: BacklinkService, useValue: { index$: of({}), backlinksFor: () => [], excludedCountFor: () => 0 } },
        { provide: ProjectWriteProtectionService, useValue: { readOnlyPath: null } },
        { provide: ImagePickerService, useValue: { state$: of({ isOpen: false }), close: () => {}, handleNavigationAway: () => true } },
        { provide: ElectronService, useValue: { onBrowserNavigationCommand: () => {}, removeBrowserNavigationCommandListener: () => {} } },
      ],
    });
    const fixture = TestBed.createComponent(LocationDetailComponent);
    fixture.componentRef.setInput('embedded', true);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const name = root.querySelector<HTMLInputElement>('#locationName')!;
    expect(root.querySelector('.location-form')).withContext(root.innerHTML).not.toBeNull();
    expect(root.querySelector('.location-form')!.firstElementChild?.className).toBe('location-identity');
    expect(root.querySelector('textarea')).toBeNull();
    expect(root.querySelector('[aria-label="Map icon preview"]')).toBeNull();
    expect(root.querySelector('.form-section')).toBeNull();
    expect(root.querySelector('app-mentioned-in')?.textContent?.trim()).toBe('');
    expect(getComputedStyle(root.querySelector('app-mentioned-in')!).display).toBe('none');
    expect(Array.from(root.querySelectorAll('button')).some(button => /^(Close|Save)$/.test(button.textContent!.trim()))).toBeFalse();

    name.focus();
    name.value = 'New Harbor';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 750));
    expect(update).not.toHaveBeenCalled();
    name.blur();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.calls.mostRecent().args[1].name).toBe('New Harbor');
    expect(fixture.componentInstance.locationForm.pristine).toBeTrue();

    const info = root.querySelector<HTMLButtonElement>('.type-info')!;
    info.click();
    const help = root.querySelector<HTMLElement>('#location-type-help')!;
    expect(help.matches(':popover-open')).toBeTrue();
    expect(help.textContent).toContain('Location types and examples');
    help.hidePopover();
    expect(root.querySelector('#location-description-help')?.hasAttribute('popover')).toBeTrue();
  });
});
