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

@Injectable({
  providedIn: 'root'
})
export class CommandPaletteService {
  private isOpenSubject = new BehaviorSubject<boolean>(false);
  public isOpen$ = this.isOpenSubject.asObservable();

  private commandsSubject = new BehaviorSubject<Command[]>([]);
  public commands$ = this.commandsSubject.asObservable();

  private placeholderSubject = new BehaviorSubject<string>('Type a command or search...');
  public placeholder$ = this.placeholderSubject.asObservable();

  private enterLabelSubject = new BehaviorSubject<string>('Execute');
  public enterLabel$ = this.enterLabelSubject.asObservable();

  private pickResolver: ((command: Command | null) => void) | null = null;
  private savedCommands: Command[] | null = null;
  private pickCloseSub: Subscription | null = null;

  constructor() { }

  open(): void {
    this.isOpenSubject.next(true);
  }

  close(): void {
    this.isOpenSubject.next(false);
  }

  toggle(): void {
    this.isOpenSubject.next(!this.isOpenSubject.value);
  }

  registerCommands(commands: Command[]): void {
    this.commandsSubject.next(commands);
  }

  addCommand(command: Command): void {
    const currentCommands = this.commandsSubject.value;
    this.commandsSubject.next([...currentCommands, command]);
  }

  removeCommand(id: string): void {
    const currentCommands = this.commandsSubject.value;
    this.commandsSubject.next(currentCommands.filter(cmd => cmd.id !== id));
  }

  /**
   * Opens the palette in picker mode with the given commands.
   * Returns the selected command, or null if the user cancelled.
   */
  pick(commands: Command[], placeholder?: string): Promise<Command | null> {
    return new Promise((resolve) => {
      this.savedCommands = this.commandsSubject.value;
      this.pickResolver = resolve;

      if (placeholder) {
        this.placeholderSubject.next(placeholder);
      }
      this.enterLabelSubject.next('Select');

      const pickerCommands = commands.map((cmd) => ({
        ...cmd,
        action: () => {
          this.resolvePick(cmd);
        },
      }));

      this.commandsSubject.next(pickerCommands);
      this.open();

      this.pickCloseSub = this.isOpen$.subscribe((isOpen) => {
        if (!isOpen && this.pickResolver) {
          this.resolvePick(null);
        }
      });
    });
  }

  private resolvePick(result: Command | null): void {
    const resolver = this.pickResolver;
    this.pickResolver = null;

    this.pickCloseSub?.unsubscribe();
    this.pickCloseSub = null;

    if (this.savedCommands !== null) {
      this.commandsSubject.next(this.savedCommands);
      this.savedCommands = null;
    }

    this.placeholderSubject.next('Type a command or search...');
    this.enterLabelSubject.next('Execute');

    resolver?.(result);
  }
}
