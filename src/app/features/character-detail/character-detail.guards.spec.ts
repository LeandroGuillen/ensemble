import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { CharacterDetailComponent } from './character-detail.component';
import { ImagePickerService } from '../../core/services';

describe('CharacterDetailComponent unsaved changes guards', () => {
  let component: CharacterDetailComponent;
  let imagePickerService: jasmine.SpyObj<ImagePickerService>;
  let confirmSpy: jasmine.Spy;

  beforeEach(() => {
    confirmSpy = jasmine.createSpy('confirm').and.resolveTo(true);
    imagePickerService = jasmine.createSpyObj('ImagePickerService', ['handleNavigationAway']);
    imagePickerService.handleNavigationAway.and.returnValue(true);

    const fb = new FormBuilder();
    component = Object.create(CharacterDetailComponent.prototype);
    component.characterForm = fb.group({ name: [''], category: [''] });
    component.bookPageData = {};
    component.bookPageOriginalContent = {};
    component.isSaving = false;
    (component as any).imagePickerService = imagePickerService;
    (component as any).modalService = { confirm: confirmSpy };
    (component as any).leavePrompt = null;
  });

  it('allows navigation when form is clean and no book pages are dirty', () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    expect(component.canLeave()).toBeTrue();
  });

  it('prompts and respects user answer when main form is dirty', async () => {
    component.characterForm.markAsDirty();
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    
    confirmSpy.and.resolveTo(false);
    expect(await component.canLeave()).toBeFalse();
    expect(confirmSpy).toHaveBeenCalledWith(
      'You have unsaved changes. Are you sure you want to leave?', 'Discard Changes', jasmine.any(Object));

    confirmSpy.calls.reset();
    confirmSpy.and.resolveTo(true);
    expect(await component.canLeave()).toBeTrue();
  });

  it('prompts when any book page is dirty', async () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(true);
    confirmSpy.and.resolveTo(false);
    expect(await component.canLeave()).toBeFalse();
    expect(confirmSpy).toHaveBeenCalledWith(
      'You have unsaved changes. Are you sure you want to leave?', 'Discard Changes', jasmine.any(Object));
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

  it('never uses the native confirm (it breaks keyboard focus in Electron)', async () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    const native = spyOn(window, 'confirm');
    component.characterForm.markAsDirty();
    await component.canLeave();
    expect(native).not.toHaveBeenCalled();
  });

  it('reuses a prompt that is already open', () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    component.characterForm.markAsDirty();
    confirmSpy.and.returnValue(new Promise(() => {}));
    const first = component.canLeave();
    expect(component.canLeave()).toBe(first);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});
