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
    component.locationForm = fb.group({ name: [''], content: [''] });
    component.isSaving = false;
    (component as any).imagePickerService = imagePickerService;
    (component as any).modalService = { confirm: confirmSpy };
    (component as any).leavePrompt = null;
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

  it('prevents window close when form is dirty', () => {
    component.locationForm.markAsDirty();
    const event = { preventDefault: jasmine.createSpy('preventDefault') } as any;
    component.beforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('allows window close when form is clean', () => {
    const event = { preventDefault: jasmine.createSpy('preventDefault') } as any;
    component.beforeUnload(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
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
