import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { LocationDetailComponent } from './location-detail.component';
import { ImagePickerService } from '../../core/services';

describe('LocationDetailComponent unsaved changes guards', () => {
  let component: LocationDetailComponent;
  let imagePickerService: jasmine.SpyObj<ImagePickerService>;
  let confirmSpy: jasmine.Spy;

  beforeEach(() => {
    confirmSpy = spyOn(window, 'confirm').and.returnValue(true);
    imagePickerService = jasmine.createSpyObj('ImagePickerService', ['handleNavigationAway']);
    imagePickerService.handleNavigationAway.and.returnValue(true);

    const fb = new FormBuilder();
    component = Object.create(LocationDetailComponent.prototype);
    component.locationForm = fb.group({ name: [''], content: [''] });
    component.isSaving = false;
    (component as any).imagePickerService = imagePickerService;
  });

  it('allows navigation when form is clean', () => {
    expect(component.canLeave()).toBeTrue();
  });

  it('prompts and respects user answer when form is dirty', () => {
    component.locationForm.markAsDirty();
    confirmSpy.and.returnValue(false);
    expect(component.canLeave()).toBeFalse();
    expect(confirmSpy).toHaveBeenCalledWith('Discard your unsaved Location changes?');

    confirmSpy.calls.reset();
    confirmSpy.and.returnValue(true);
    expect(component.canLeave()).toBeTrue();
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
});
