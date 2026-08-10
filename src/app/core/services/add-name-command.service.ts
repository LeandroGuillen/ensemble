import { Injectable } from '@angular/core';
import { BackstageService } from './backstage.service';
import { CommandPaletteService, Command } from '../../shared/command-palette/command-palette.service';
import { NotificationService } from './notification.service';
import { LoggingService } from './logging.service';
import { NameList } from '../interfaces/backstage.interface';

/**
 * Command-palette flow for adding a name to a name list.
 */
@Injectable({
  providedIn: 'root',
})
export class AddNameCommandService {
  constructor(
    private backstageService: BackstageService,
    private commandPaletteService: CommandPaletteService,
    private notificationService: NotificationService,
    private logger: LoggingService
  ) {}

  /** Register (or refresh) the global New Name palette command. */
  register(): void {
    this.commandPaletteService.replaceGroup('Names', [
      {
        id: 'add-name',
        label: 'New Name',
        icon: '➕',
        keywords: ['name', 'names', 'new', 'create', 'list', 'add'],
        group: 'Names',
        action: () => {
          // Defer so the palette can finish closing before prompt/pick reopen it
          setTimeout(() => void this.run(), 0);
        },
      },
    ]);
  }

  async run(): Promise<void> {
    try {
      await this.backstageService.loadBackstageData();

      const name = await this.commandPaletteService.prompt('Enter a name...');
      if (!name) return;

      const listIndex = await this.pickNameList();
      if (listIndex === null) return;

      await this.backstageService.addNameToList(listIndex, name);

      const listTitle = this.backstageService.getNameLists()[listIndex]?.title ?? 'list';
      this.notificationService.showSuccess(`Added “${name}” to ${listTitle}`);
    } catch (error) {
      this.logger.error('Failed to add name from command palette', error);
      this.notificationService.showError(
        error instanceof Error ? error.message : 'Failed to add name'
      );
    }
  }

  /**
   * Returns the chosen list index, creates a default list when none exist,
   * or null if the user cancelled.
   */
  private async pickNameList(): Promise<number | null> {
    let nameLists = this.backstageService.getNameLists();

    if (nameLists.length === 0) {
      await this.backstageService.addNameList({ title: 'Names', names: [] });
      nameLists = this.backstageService.getNameLists();
      return 0;
    }

    if (nameLists.length === 1) {
      return 0;
    }

    const commands: Command[] = nameLists.map((list, index) =>
      this.toListCommand(list, index)
    );

    const picked = await this.commandPaletteService.pick(
      commands,
      'Add name to which list?'
    );
    if (!picked) return null;

    const match = /^name-list-(\d+)$/.exec(picked.id);
    return match ? Number(match[1]) : null;
  }

  private toListCommand(list: NameList, index: number): Command {
    const count = list.names.length;
    return {
      id: `name-list-${index}`,
      label: list.title || 'Untitled list',
      metadata: `${count} name${count === 1 ? '' : 's'}`,
      keywords: [list.title, 'name', 'list'],
      group: 'name-lists',
      action: () => {},
    };
  }
}
