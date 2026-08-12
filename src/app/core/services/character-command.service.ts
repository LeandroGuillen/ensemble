import { Injectable } from '@angular/core';
import { Character } from '../interfaces/character.interface';
import { CommandPaletteService } from '../../shared/command-palette/command-palette.service';
import { CharacterEditDialogService } from './character-edit-dialog.service';
import { CharacterService } from './character.service';
import { MetadataHelperService } from './metadata-helper.service';

/** Keeps character-related commands available independently of the active route. */
@Injectable({
  providedIn: 'root',
})
export class CharacterCommandService {
  private active = false;
  private subscribed = false;

  constructor(
    private characterService: CharacterService,
    private commandPaletteService: CommandPaletteService,
    private characterEditDialog: CharacterEditDialogService,
    private metadataHelper: MetadataHelperService,
  ) {}

  activate(): void {
    this.active = true;

    if (!this.subscribed) {
      this.subscribed = true;
      this.characterService.getCharacters().subscribe((characters) => {
        if (this.active) {
          this.publishAndLoadThumbnails(characters);
        }
      });
    } else {
      this.publishAndLoadThumbnails(this.characterService.getCharactersSnapshot());
    }
  }

  deactivate(): void {
    this.active = false;
    this.commandPaletteService.replaceGroup('characters', []);
  }

  private publish(characters: Character[]): void {
    this.commandPaletteService.replaceGroup('characters', [
      {
        id: 'new-character',
        label: 'New Character',
        icon: '➕',
        keywords: ['create', 'add', 'character', 'new'],
        group: 'characters',
        action: () => this.characterEditDialog.openCreate(),
      },
      ...characters.map((character) => ({
        id: `character-${character.id}`,
        label: character.name,
        thumbnail: this.characterService.getCachedThumbnail(character.id) || undefined,
        metadata: this.metadataHelper.getCategoryName(character.category),
        keywords: [
          character.name,
          this.metadataHelper.getCategoryName(character.category),
          ...character.tags.map((tagId) => this.metadataHelper.getTagName(tagId)),
          ...character.books.map((bookId) => this.metadataHelper.getBookName(bookId)),
        ],
        group: 'characters',
        action: () => this.characterEditDialog.openEdit(character.id),
      })),
    ]);
  }

  private publishAndLoadThumbnails(characters: Character[]): void {
    this.publish(characters);
    void this.characterService.loadThumbnailsForCharacters(characters).then(() => {
      if (this.active) {
        this.publish(this.characterService.getCharactersSnapshot());
      }
    });
  }
}
