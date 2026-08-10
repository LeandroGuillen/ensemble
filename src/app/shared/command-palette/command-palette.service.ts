import { Injectable } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';

export interface Command {
  id: string;
  label: string;
  icon?: string;
  action: () => void;
  keywords?: string[];
  thumbnail?: string;
  metadata?: string;
  group?: string;
}

/** Display order for command groups. Unknown groups sort after these, before ungrouped. */
const GROUP_ORDER = [
  'create',
  'Concepts',
  'Names',
  'characters',
  'view',
  'Appearance',
  'Help',
] as const;

@Injectable({
  providedIn: 'root'
})
export class CommandPaletteService {
  private isOpenSubject = new BehaviorSubject<boolean>(false);
  public isOpen$ = this.isOpenSubject.asObservable();

  /** What the palette UI currently shows (durable list, or a temporary pick/prompt list). */
  private commandsSubject = new BehaviorSubject<Command[]>([]);
  public commands$ = this.commandsSubject.asObservable();

  private placeholderSubject = new BehaviorSubject<string>('Type a command or search...');
  public placeholder$ = this.placeholderSubject.asObservable();

  private enterLabelSubject = new BehaviorSubject<string>('Execute');
  public enterLabel$ = this.enterLabelSubject.asObservable();

  private promptModeSubject = new BehaviorSubject<boolean>(false);
  public promptMode$ = this.promptModeSubject.asObservable();

  /** Source of truth for registered commands — never overwritten by pick/prompt UI. */
  private durableCommands: Command[] = [];
  private transientActive = false;

  private pickResolver: ((command: Command | null) => void) | null = null;
  private promptResolver: ((value: string | null) => void) | null = null;
  private modeCloseSub: Subscription | null = null;

  constructor() { }

  open(): void {
    // Normal open must always show the durable registry, never a leftover pick/prompt list.
    if (!this.transientActive) {
      this.publishDurable();
      this.resetChrome();
    }
    this.isOpenSubject.next(true);
  }

  close(): void {
    this.isOpenSubject.next(false);
  }

  toggle(): void {
    if (this.isOpenSubject.value) {
      this.close();
    } else {
      this.open();
    }
  }

  /** Replace the entire durable command list. Prefer {@link replaceGroup} for page-scoped updates. */
  registerCommands(commands: Command[]): void {
    this.durableCommands = [...commands];
    if (!this.transientActive) {
      this.publishDurable();
    }
  }

  /**
   * Replace all commands in a group, preserving every other group and this group's slot.
   * Safe to call while prompt/pick is open — updates the durable list only.
   */
  replaceGroup(group: string, commands: Command[]): void {
    const firstIdx = this.durableCommands.findIndex((cmd) => cmd.group === group);
    const others = this.durableCommands.filter((cmd) => cmd.group !== group);

    if (commands.length === 0) {
      this.durableCommands = others;
    } else if (firstIdx === -1) {
      this.durableCommands = [...others, ...commands];
    } else {
      const insertAt = this.durableCommands
        .slice(0, firstIdx)
        .filter((cmd) => cmd.group !== group).length;
      this.durableCommands = [
        ...others.slice(0, insertAt),
        ...commands,
        ...others.slice(insertAt),
      ];
    }

    if (!this.transientActive) {
      this.publishDurable();
    }
  }

  addCommand(command: Command): void {
    const idx = this.durableCommands.findIndex((cmd) => cmd.id === command.id);
    if (idx >= 0) {
      const next = [...this.durableCommands];
      next[idx] = command;
      this.durableCommands = next;
    } else {
      this.durableCommands = [...this.durableCommands, command];
    }
    if (!this.transientActive) {
      this.publishDurable();
    }
  }

  removeCommand(id: string): void {
    this.durableCommands = this.durableCommands.filter((cmd) => cmd.id !== id);
    if (!this.transientActive) {
      this.publishDurable();
    }
  }

  /**
   * Opens the palette in picker mode with the given commands.
   * Returns the selected command, or null if the user cancelled.
   */
  pick(commands: Command[], placeholder?: string): Promise<Command | null> {
    return new Promise((resolve) => {
      this.beginTransientMode();
      this.pickResolver = resolve;

      if (placeholder) {
        this.placeholderSubject.next(placeholder);
      }
      this.enterLabelSubject.next('Select');
      this.promptModeSubject.next(false);

      const pickerCommands = commands.map((cmd) => ({
        ...cmd,
        action: () => {
          this.resolvePick(cmd);
        },
      }));

      this.commandsSubject.next(pickerCommands);
      this.isOpenSubject.next(true);
      this.watchCloseForCancel(() => this.resolvePick(null));
    });
  }

  /**
   * Opens the palette in free-text prompt mode.
   * Enter submits the current query; Escape / backdrop cancels.
   */
  prompt(placeholder = 'Enter text...'): Promise<string | null> {
    return new Promise((resolve) => {
      this.beginTransientMode();
      this.promptResolver = resolve;

      this.placeholderSubject.next(placeholder);
      this.enterLabelSubject.next('Confirm');
      this.promptModeSubject.next(true);
      this.commandsSubject.next([]);
      this.isOpenSubject.next(true);
      this.watchCloseForCancel(() => this.resolvePrompt(null));
    });
  }

  /** Submit the typed value while in prompt mode (called by the palette UI). */
  submitPrompt(value: string): void {
    if (!this.promptResolver) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    this.resolvePrompt(trimmed);
  }

  isPromptMode(): boolean {
    return this.promptModeSubject.value;
  }

  private publishDurable(): void {
    this.commandsSubject.next(this.sortCommands(this.durableCommands));
  }

  private sortCommands(commands: Command[]): Command[] {
    const rank = (group?: string): number => {
      if (!group) return GROUP_ORDER.length + 1;
      const idx = (GROUP_ORDER as readonly string[]).indexOf(group);
      return idx === -1 ? GROUP_ORDER.length : idx;
    };

    return [...commands]
      .map((cmd, index) => ({ cmd, index }))
      .sort((a, b) => {
        const byGroup = rank(a.cmd.group) - rank(b.cmd.group);
        if (byGroup !== 0) return byGroup;
        return a.index - b.index;
      })
      .map(({ cmd }) => cmd);
  }

  private resetChrome(): void {
    this.placeholderSubject.next('Type a command or search...');
    this.enterLabelSubject.next('Execute');
    this.promptModeSubject.next(false);
  }

  private beginTransientMode(): void {
    this.transientActive = true;
  }

  private watchCloseForCancel(onCancel: () => void): void {
    this.modeCloseSub?.unsubscribe();
    this.modeCloseSub = this.isOpen$.subscribe((isOpen) => {
      if (!isOpen && (this.pickResolver || this.promptResolver)) {
        onCancel();
      }
    });
  }

  private resolvePick(result: Command | null): void {
    const resolver = this.pickResolver;
    this.pickResolver = null;
    this.endTransientMode();
    resolver?.(result);
  }

  private resolvePrompt(result: string | null): void {
    const resolver = this.promptResolver;
    this.promptResolver = null;
    this.endTransientMode();
    resolver?.(result);
  }

  private endTransientMode(): void {
    this.modeCloseSub?.unsubscribe();
    this.modeCloseSub = null;
    this.transientActive = false;

    this.publishDurable();
    this.resetChrome();

    if (this.isOpenSubject.value) {
      this.close();
    }
  }
}
