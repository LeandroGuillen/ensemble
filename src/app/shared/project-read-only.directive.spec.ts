import { PinboardToolbarComponent } from '../features/pinboard-view/components/pinboard-toolbar/pinboard-toolbar.component';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ProjectWriteProtectionService } from '../core/services/project-write-protection.service';
import { MarkdownEditorComponent } from './markdown-editor/markdown-editor.component';
import { ProjectReadOnlyDirective } from './project-read-only.directive';

@Component({
  imports: [FormsModule, ReactiveFormsModule, MarkdownEditorComponent, ProjectReadOnlyDirective],
  template: `
    <input appProjectReadOnly [formControl]="name">
    <textarea appProjectReadOnly [(ngModel)]="description"></textarea>
    <select appProjectReadOnly [(ngModel)]="category"><option value="main">Main</option></select>
    <app-markdown-editor appProjectReadOnly [formControl]="content" />
    <app-markdown-editor appProjectReadOnly [(ngModel)]="description" />
    <input type="search" [(ngModel)]="search">
    <button (click)="navigated = true">Browse</button>
    <button appProjectReadOnly title="Delete member" (click)="removed = true">Remove</button>
  `,
})
class Editor {
  name = new FormControl('Name');
  content = new FormControl('Description');
  description = 'Description';
  category = 'main';
  search = '';
  navigated = false;
  removed = false;
}

describe('ProjectReadOnlyDirective', () => {
  it('disables actions with a read-only hint and restores their original tooltip', () => {
    const fixture = TestBed.createComponent(Editor);
    const protection = TestBed.inject(ProjectWriteProtectionService);
    protection.readOnlyPath = '/project';
    fixture.detectChanges();
    const action: HTMLButtonElement = fixture.nativeElement.querySelector('button[appProjectReadOnly]');
    expect(action.disabled).toBeTrue();
    expect(action.title).toContain('read-only');
    action.click();
    expect(fixture.componentInstance.removed).toBeFalse();
    protection.readOnlyPath = null;
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(action.disabled).toBeFalse();
    expect(action.title).toBe('Delete member');
    action.click();
    expect(fixture.componentInstance.removed).toBeTrue();
  });

  it('disables reactive, template and Markdown fields, preserving content and browsing', async () => {
    const fixture = TestBed.createComponent(Editor);
    const protection = TestBed.inject(ProjectWriteProtectionService);
    protection.readOnlyPath = '/project';
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    for (const field of root.querySelectorAll<HTMLInputElement>('input:not([type=search]), textarea, select')) {
      expect(field.disabled).toBeTrue();
    }
    for (const editor of root.querySelectorAll('.cm-content')) {
      expect(editor.getAttribute('contenteditable')).toBe('false');
    }
    expect(fixture.componentInstance.name.value).toBe('Name');
    expect(fixture.componentInstance.name.dirty).toBeFalse();
    expect(root.querySelector<HTMLInputElement>('input[type=search]')!.disabled).toBeFalse();
    root.querySelector('button')!.click();
    expect(fixture.componentInstance.navigated).toBeTrue();

    protection.readOnlyPath = null;
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(root.querySelector<HTMLInputElement>('input')!.disabled).toBeFalse();
    expect(root.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('true');
  });
});


describe('Read-only pinboard actions', () => {
  it('blocks Add Member while keeping zoom available', () => {
    const fixture = TestBed.createComponent(PinboardToolbarComponent);
    TestBed.inject(ProjectWriteProtectionService).readOnlyPath = '/project';
    fixture.detectChanges();
    const add = spyOn(fixture.componentInstance.pinCharacter, 'emit');
    const zoom = spyOn(fixture.componentInstance.zoomOut, 'emit');
    const root: HTMLElement = fixture.nativeElement;
    const button = root.querySelector<HTMLButtonElement>('.pin-character-btn')!;
    expect(button.disabled).toBeTrue();
    expect(button.title).toContain('read-only');
    button.click();
    expect(add).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('.zoom-controls button')!.click();
    expect(zoom).toHaveBeenCalled();
  });
});
