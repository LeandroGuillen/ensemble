import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { LocationDetailComponent } from './location-detail.component';
import { ImagePickerService } from '../../core/services';

describe('LocationDetailComponent unsaved changes guards', () => {
  let component: LocationDetailComponent;
  let imagePickerService: jasmine.SpyObj<ImagePickerService>;
  let confirmSpy: jasmine.Spy;

  beforeEach(() => {
    confirmSpy = jasmine.createSpy('confirm').and.resolveTo(true);
    imagePickerService = jasmine.createSpyObj('ImagePickerService', ['handleNavigationAway']);
    imagePickerService.handleNavigationAway.and.returnValue(true);

    const fb = new FormBuilder();
    component = Object.create(LocationDetailComponent.prototype);
    component.locationForm = fb.group({ name: [''], content: [''], aliasesText: [''] });
    component.isSaving = false;
    (component as any).imagePickerService = imagePickerService;
    (component as any).modalService = { confirm: confirmSpy };
    (component as any).leavePrompt = null;
  });

  it('opens the created location sidebar after saving without the leave guard blocking it', async () => {
    component.embedded = true;
    component.isNewLocation = true;
    component.locationForm.patchValue({ name: 'Harbor', content: 'Coastal port' });
    component.locationForm.markAsDirty();
    (component as any).locationService = { createLocation: jasmine.createSpy().and.resolveTo({ id: 'new-id', name: 'Harbor' }) };
    const navigate = jasmine.createSpy().and.callFake(async () => {
      expect(component.canLeave()).toBeTrue();
      return true;
    });
    (component as any).router = { navigate };
    (component as any).notificationService = { showSuccess: () => {} };
    (component as any).logger = { error: () => {} };
    (component as any).cdr = { markForCheck: () => {} };
    await component.saveLocation();
    expect(navigate).toHaveBeenCalledWith(['/location', 'new-id'], { queryParamsHandling: 'preserve' });
    expect(component.locationForm.pristine).toBeTrue();
    expect(component.isSaving).toBeFalse();
  });

  it('keeps renamed links and aliases in the open sidebar for subsequent saves', async () => {
    component.embedded = true;
    component.isNewLocation = false;
    component.locationId = 'a';
    component.location = { id: 'a', name: 'Old harbor' } as any;
    component.locationForm.patchValue({ name: 'New harbor', content: 'Original' });
    const updated = { id: 'a', name: 'New harbor', aliases: ['Old harbor'], content: 'Rewritten [[New harbor]]' };
    (component as any).linkRename = { run: jasmine.createSpy().and.resolveTo(updated) };
    (component as any).notificationService = { showSuccess: () => {} };
    (component as any).logger = { error: () => {} };
    (component as any).cdr = { markForCheck: () => {} };
    const navigate = jasmine.createSpy();
    (component as any).router = { navigate };
    await component.saveLocation();
    expect(component.locationForm.get('content')?.value).toBe(updated.content);
    expect(component.locationForm.get('aliasesText')?.value).toBe('Old harbor');
    expect(component.locationForm.pristine).toBeTrue();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('blocks saves while another location is loading or failed to load', async () => {
    const create = jasmine.createSpy();
    (component as any).locationService = { createLocation: create };
    component.isNewLocation = true;
    component.isLoading = true;
    await component.saveLocation();
    component.isLoading = false;
    component.loadError = 'Location not found';
    await component.saveLocation();
    expect(create).not.toHaveBeenCalled();
  });

  it('allows navigation when form is clean', () => {
    expect(component.canLeave()).toBeTrue();
  });

  it('prompts and respects user answer when form is dirty', async () => {
    component.locationForm.markAsDirty();
    confirmSpy.and.resolveTo(false);
    expect(await component.canLeave()).toBeFalse();
    expect(confirmSpy).toHaveBeenCalledWith(
      'You have unsaved changes. Are you sure you want to leave?', 'Discard Changes', jasmine.any(Object));

    confirmSpy.calls.reset();
    confirmSpy.and.resolveTo(true);
    expect(await component.canLeave()).toBeTrue();
  });

  it('blocks navigation when image picker is open', () => {
    imagePickerService.handleNavigationAway.and.returnValue(false);
    expect(component.canLeave()).toBeFalse();
  });

  it('blocks navigation when saving', () => {
    component.isSaving = true;
    expect(component.canLeave()).toBeFalse();
  });

  it('allows navigation after successful save', () => {
    component.locationForm.markAsDirty();
    component.locationForm.markAsPristine();
    expect(component.canLeave()).toBeTrue();
  });

  it('leaves window close to the IPC guard instead of silently cancelling beforeunload', () => {
    expect((component as any).beforeUnload).toBeUndefined();
  });

  it('offers Discard and close for unsaveable edits', async () => {
    component.locationForm.markAsDirty();
    confirmSpy.and.resolveTo(false);
    expect(await component.canLeave(true)).toBeFalse();
    expect(confirmSpy).toHaveBeenCalledWith(
      jasmine.stringContaining('read-only'), 'Discard Changes',
      jasmine.objectContaining({ confirmText: 'Discard and close' }));
    confirmSpy.and.resolveTo(true);
    expect(await component.canLeave(true)).toBeTrue();
  });

  it('never uses the native confirm (it breaks keyboard focus in Electron)', async () => {
    const native = spyOn(window, 'confirm');
    component.locationForm.markAsDirty();
    await component.canLeave();
    expect(native).not.toHaveBeenCalled();
  });

  it('reuses a prompt that is already open', () => {
    component.locationForm.markAsDirty();
    confirmSpy.and.returnValue(new Promise(() => {}));
    const first = component.canLeave();
    expect(component.canLeave()).toBe(first);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});
