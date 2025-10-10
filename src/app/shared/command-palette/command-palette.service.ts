import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

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
}
