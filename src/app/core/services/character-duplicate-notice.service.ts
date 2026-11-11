import { Injectable } from '@angular/core';

/** Undismissed copy notices for this app session, isolated by project and stable record id. */
@Injectable({ providedIn: 'root' })
export class CharacterDuplicateNoticeService {
  private readonly notices = new Map<string, string>();

  remember(projectPath: string, recordId: string, sourceName: string): void {
    this.notices.set(JSON.stringify([projectPath, recordId]), sourceName);
  }

  get(projectPath: string, recordId: string): string | null {
    return this.notices.get(JSON.stringify([projectPath, recordId])) ?? null;
  }

  dismiss(projectPath: string, recordId: string): void {
    this.notices.delete(JSON.stringify([projectPath, recordId]));
  }
}
