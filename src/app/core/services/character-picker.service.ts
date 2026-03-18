import { Injectable } from '@angular/core';
import { Character } from '../interfaces/character.interface';
import { CommandPaletteService, Command } from '../../shared/command-palette/command-palette.service';
import { CharacterService } from './character.service';
import { ProjectService } from './project.service';
import { MetadataHelperService } from './metadata-helper.service';

@Injectable({
  providedIn: 'root',
})
export class CharacterPickerService {
  constructor(
    private commandPaletteService: CommandPaletteService,
    private characterService: CharacterService,
    private projectService: ProjectService,
    private metadataHelper: MetadataHelperService
  ) {}

  /**
   * Opens a character picker using the command palette UI.
   * Returns the selected character, or null if cancelled.
   */
  async pick(): Promise<Character | null> {
    const project = this.projectService.getCurrentProject();
    if (project?.path) {
      await this.characterService.loadCharacters(project.path);
    }

    const characters = this.characterService['charactersSubject'].value as Character[];

    await this.characterService.loadThumbnailsForCharacters(characters);

    const commands: Command[] = characters.map((char) => ({
      id: `pick-${char.id}`,
      label: char.name,
      thumbnail: this.characterService.getCachedThumbnail(char.id) || undefined,
      metadata: this.metadataHelper.getCategoryName(char.category),
      keywords: [
        char.name,
        this.metadataHelper.getCategoryName(char.category),
        ...char.tags.map((t) => this.metadataHelper.getTagName(t)),
      ],
      group: 'characters',
      action: () => {},
    }));

    const picked = await this.commandPaletteService.pick(commands, 'Search characters...');
    if (!picked) return null;

    const charId = picked.id.replace(/^pick-/, '');
    return characters.find((c) => c.id === charId) ?? null;
  }
}
