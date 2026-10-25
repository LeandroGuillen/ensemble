import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { CharacterDetailComponent } from './character-detail.component';
import { ImagePickerService } from '../../core/services';

describe('CharacterDetailComponent unsaved changes guards', () => {
  let component: CharacterDetailComponent;
  let imagePickerService: jasmine.SpyObj<ImagePickerService>;
  let confirmSpy: jasmine.Spy;

  beforeEach(() => {
    confirmSpy = spyOn(window, 'confirm').and.returnValue(true);
    imagePickerService = jasmine.createSpyObj('ImagePickerService', ['handleNavigationAway']);
    imagePickerService.handleNavigationAway.and.returnValue(true);

    const fb = new FormBuilder();
    component = Object.create(CharacterDetailComponent.prototype);
    component.characterForm = fb.group({ name: [''], category: [''] });
    component.bookPageData = {};
    component.bookPageOriginalContent = {};
    component.isSaving = false;
    (component as any).imagePickerService = imagePickerService;
  });

  it('allows navigation when form is clean and no book pages are dirty', () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    expect(component.canLeave()).toBeTrue();
  });

  it('prompts and respects user answer when main form is dirty', () => {
    component.characterForm.markAsDirty();
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    
    confirmSpy.and.returnValue(false);
    expect(component.canLeave()).toBeFalse();
    expect(confirmSpy).toHaveBeenCalledWith('Discard your unsaved Character changes?');

    confirmSpy.calls.reset();
    confirmSpy.and.returnValue(true);
    expect(component.canLeave()).toBeTrue();
  });

  it('prompts when any book page is dirty', () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(true);
    confirmSpy.and.returnValue(false);
    expect(component.canLeave()).toBeFalse();
    expect(confirmSpy).toHaveBeenCalledWith('Discard your unsaved Character changes?');
  });

  it('blocks navigation when image picker is open', () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    imagePickerService.handleNavigationAway.and.returnValue(false);
    expect(component.canLeave()).toBeFalse();
  });

  it('blocks navigation when saving', () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    component.isSaving = true;
    expect(component.canLeave()).toBeFalse();
  });

  it('allows navigation after successful save', () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    component.characterForm.markAsDirty();
    component.characterForm.markAsPristine();
    expect(component.canLeave()).toBeTrue();
  });

  it('prevents window close when main form is dirty', () => {
    component.characterForm.markAsDirty();
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    const event = { preventDefault: jasmine.createSpy('preventDefault') } as any;
    component.beforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('prevents window close when any book page is dirty', () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(true);
    const event = { preventDefault: jasmine.createSpy('preventDefault') } as any;
    component.beforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('allows window close when form is clean and no book pages are dirty', () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    const event = { preventDefault: jasmine.createSpy('preventDefault') } as any;
    component.beforeUnload(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
