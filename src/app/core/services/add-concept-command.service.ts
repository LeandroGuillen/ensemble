import { Injectable } from '@angular/core';
import { BackstageService } from './backstage.service';
import { CommandPaletteService } from '../../shared/command-palette/command-palette.service';
import { NotificationService } from './notification.service';
import { LoggingService } from './logging.service';

/**
 * Command-palette flow for adding a character concept.
 */
@Injectable({
  providedIn: 'root',
})
export class AddConceptCommandService {
  constructor(
    private backstageService: BackstageService,
    private commandPaletteService: CommandPaletteService,
    private notificationService: NotificationService,
    private logger: LoggingService
  ) {}

  /** Register (or refresh) the global New Concept palette command. */
  register(): void {
    this.commandPaletteService.removeCommand('add-concept');
    this.commandPaletteService.addCommand({
      id: 'add-concept',
      label: 'New Concept',
      icon: '➕',
      keywords: ['concept', 'concepts', 'new', 'create', 'idea', 'brainstorm', 'add'],
      group: 'Concepts',
      action: () => {
        // Defer so the palette can finish closing before prompt reopens it
        setTimeout(() => void this.run(), 0);
      },
    });
  }

  async run(): Promise<void> {
    try {
      await this.backstageService.loadBackstageData();

      const title = await this.commandPaletteService.prompt('Enter a concept title...');
      if (title === null) return;

      await this.backstageService.addConcept({
        title: title.trim(),
        notes: '',
      });

      const label = title.trim() || 'Untitled Concept';
      this.notificationService.showSuccess(`Added concept “${label}”`);
    } catch (error) {
      this.logger.error('Failed to add concept from command palette', error);
      this.notificationService.showError(
        error instanceof Error ? error.message : 'Failed to add concept'
      );
    }
  }
}
