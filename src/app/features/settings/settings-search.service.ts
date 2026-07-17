import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SettingsSearchService {
  private readonly querySubject = new BehaviorSubject<string>('');
  readonly query$ = this.querySubject.asObservable();

  get query(): string {
    return this.querySubject.value;
  }

  setQuery(query: string): void {
    this.querySubject.next(query.trim());
  }

  clear(): void {
    this.querySubject.next('');
  }

  matches(...terms: Array<string | null | undefined | number | boolean>): boolean {
    const query = this.query.toLowerCase();
    if (!query) {
      return true;
    }
    return terms.some((term) => {
      if (term === null || term === undefined || term === '') {
        return false;
      }
      return String(term).toLowerCase().includes(query);
    });
  }
}
