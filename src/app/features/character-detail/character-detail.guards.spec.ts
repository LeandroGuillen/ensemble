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

  it('lets Duplicate open the copy (the leave guard does not block it) and only one copy per click', async () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    component.isEditing = true;
    component.character = { id: 'draft-1', name: '', draft: true } as any;
    (component as any).cdr = { markForCheck: () => {} };
    (component as any).notificationService = jasmine.createSpyObj('NotificationService', ['showWarning']);
    const guardDuringNavigation: Array<boolean | Promise<boolean>> = [];
    let release!: () => void;
    const duplicate = jasmine.createSpy('duplicate').and.callFake(async () => {
      guardDuringNavigation.push(component.canLeave());
      await new Promise<void>((resolve) => (release = resolve));
      return null;
    });
    (component as any).characterDuplicate = { duplicate };

    const first = component.duplicateCharacter();
    await component.duplicateCharacter(); // second click while the first is running
    release();
    await first;

    expect(guardDuringNavigation).toEqual([true]);
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(component.isDuplicating).toBeFalse();
  });

  it('allows navigation after successful save', () => {
    component.hasAnyBookPageDirty = jasmine.createSpy().and.returnValue(false);
    component.characterForm.markAsDirty();
    component.characterForm.markAsPristine();
    expect(component.canLeave()).toBeTrue();
  });

  it('leaves window close to the IPC guard instead of silently cancelling beforeunload', () => {
    expect((component as any).beforeUnload).toBeUndefined();
  });

  it('offers Discard and close for unsaveable edits', async () => {
    component.characterForm.markAsDirty();
    component.hasAnyBookPageDirty = () => false;
    confirmSpy.and.resolveTo(false);
    expect(await component.canLeave(true)).toBeFalse();
    expect(confirmSpy).toHaveBeenCalledWith(
      jasmine.stringContaining('read-only'), 'Discard Changes',
      jasmine.objectContaining({ confirmText: 'Discard and close' }));
    confirmSpy.and.resolveTo(true);
    expect(await component.canLeave(true)).toBeTrue();
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
