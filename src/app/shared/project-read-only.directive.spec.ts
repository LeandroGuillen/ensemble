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
  `,
})
class Editor {
  name = new FormControl('Name');
  content = new FormControl('Description');
  description = 'Description';
  category = 'main';
  search = '';
  navigated = false;
}

describe('ProjectReadOnlyDirective', () => {
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
    fixture.detectChanges();
    expect(root.querySelector<HTMLInputElement>('input')!.disabled).toBeFalse();
    expect(root.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('true');
  });
});
