import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Character, CharacterFormData, Category, Tag } from '../../core/interfaces';
import { CharacterService, ProjectService } from '../../core/services';

@Component({
  selector: 'app-character-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './character-detail.component.html',
  styleUrls: ['./character-detail.component.scss']
})
export class CharacterDetailComponent implements OnInit {
  characterForm: FormGroup;
  character: Character | null = null;
  categories: Category[] = [];
  tags: Tag[] = [];
  isEditing = false;
  isLoading = false;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private characterService: CharacterService,
    private projectService: ProjectService
  ) {
    this.characterForm = this.createForm();
  }

  ngOnInit(): void {
    this.categories = this.projectService.getCategories();
    this.tags = this.projectService.getTags();
    
    const characterId = this.route.snapshot.paramMap.get('id');
    if (characterId) {
      this.isEditing = true;
      this.loadCharacter(characterId);
    }
  }

  private createForm(): FormGroup {
    return this.fb.group({
      name: ['', Validators.required],
      category: ['', Validators.required],
      tags: [[]],
      thumbnail: [''],
      description: [''],
      notes: ['']
    });
  }

  private loadCharacter(id: string): void {
    this.character = this.characterService.getCharacterById(id) || null;
    if (this.character) {
      this.characterForm.patchValue({
        name: this.character.name,
        category: this.character.category,
        tags: this.character.tags,
        thumbnail: this.character.thumbnail,
        description: this.character.description,
        notes: this.character.notes
      });
    } else {
      this.error = 'Character not found';
    }
  }

  async onSubmit(): Promise<void> {
    if (this.characterForm.invalid) return;

    this.isLoading = true;
    this.error = null;

    try {
      const formData: CharacterFormData = this.characterForm.value;
      
      if (this.isEditing && this.character) {
        await this.characterService.updateCharacter(this.character.id, formData);
      } else {
        await this.characterService.createCharacter(formData);
      }
      
      this.router.navigate(['/characters']);
    } catch (error) {
      this.error = 'Failed to save character';
      console.error('Save error:', error);
    } finally {
      this.isLoading = false;
    }
  }

  onCancel(): void {
    this.router.navigate(['/characters']);
  }

  onTagChange(tagId: string, checked: boolean): void {
    const currentTags = this.characterForm.get('tags')?.value || [];
    let updatedTags: string[];
    
    if (checked) {
      updatedTags = [...currentTags, tagId];
    } else {
      updatedTags = currentTags.filter((id: string) => id !== tagId);
    }
    
    this.characterForm.patchValue({ tags: updatedTags });
  }

  isTagSelected(tagId: string): boolean {
    const selectedTags = this.characterForm.get('tags')?.value || [];
    return selectedTags.includes(tagId);
  }

  async selectThumbnail(): Promise<void> {
    // TODO: Implement thumbnail selection
    console.log('Thumbnail selection not yet implemented');
  }
}