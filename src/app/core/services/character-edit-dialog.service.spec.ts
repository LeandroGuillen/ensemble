import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { CharacterEditDialogService } from './character-edit-dialog.service';
import { ProjectWriteProtectionService } from './project-write-protection.service';

describe('Character creation in read-only projects', () => {
  it('blocks creation routes from shortcuts while keeping existing characters browsable', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const editor = TestBed.inject(CharacterEditDialogService);
    TestBed.inject(ProjectWriteProtectionService).readOnlyPath = '/project';
    editor.openCreate();
    editor.openCreateLore();
    editor.openCreateDraft();
    expect(navigate).not.toHaveBeenCalled();
    editor.openEdit('ned');
    expect(navigate).toHaveBeenCalledWith(['/character', 'ned']);
    editor.openEditDraft('draft');
    expect(navigate).toHaveBeenCalledWith(['/character-draft', 'draft']);
    TestBed.inject(ProjectWriteProtectionService).readOnlyPath = null;
    editor.openCreate();
    expect(navigate).toHaveBeenCalledWith(['/character'], undefined);
  });
});
