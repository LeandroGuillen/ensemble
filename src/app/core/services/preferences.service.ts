import { Injectable } from '@angular/core';

/**
 * Service for managing user preferences via localStorage
 *
 * Provides type-safe access to localStorage with proper serialization.
 */
@Injectable({
  providedIn: 'root'
})
export class PreferencesService {
  // Character list view preferences
  getViewMode(): 'grid' | 'list' | 'compact' | 'gallery' {
    return (localStorage.getItem('characterViewMode') as any) || 'grid';
  }

  setViewMode(mode: 'grid' | 'list' | 'compact' | 'gallery'): void {
    localStorage.setItem('characterViewMode', mode);
  }

  getColumns(): 1 | 2 {
    const saved = localStorage.getItem('characterColumns');
    return saved ? (parseInt(saved) as 1 | 2) : 2;
  }

  setColumns(columns: 1 | 2): void {
    localStorage.setItem('characterColumns', columns.toString());
  }

  getSortBy(): 'name' | 'category' {
    return (localStorage.getItem('characterSortBy') as any) || 'name';
  }

  setSortBy(sortBy: 'name' | 'category'): void {
    localStorage.setItem('characterSortBy', sortBy);
  }

  getSortDirection(): 'asc' | 'desc' {
    return (localStorage.getItem('characterSortDirection') as any) || 'asc';
  }

  setSortDirection(direction: 'asc' | 'desc'): void {
    localStorage.setItem('characterSortDirection', direction);
  }

  getGroupBy(): 'none' | 'category' | 'tag' {
    return (localStorage.getItem('characterGroupBy') as any) || 'none';
  }

  setGroupBy(groupBy: 'none' | 'category' | 'tag'): void {
    localStorage.setItem('characterGroupBy', groupBy);
  }

  getSearchTerm(): string {
    return localStorage.getItem('characterSearchTerm') || '';
  }

  setSearchTerm(term: string): void {
    localStorage.setItem('characterSearchTerm', term);
  }

  getSelectedCategory(): string {
    return localStorage.getItem('characterSelectedCategory') || '';
  }

  setSelectedCategory(category: string): void {
    localStorage.setItem('characterSelectedCategory', category);
  }

  getSelectedTags(): string[] {
    const saved = localStorage.getItem('characterSelectedTags');
    return saved ? JSON.parse(saved) : [];
  }

  setSelectedTags(tags: string[]): void {
    localStorage.setItem('characterSelectedTags', JSON.stringify(tags));
  }

  getSelectedBooks(): string[] {
    const saved = localStorage.getItem('characterSelectedBooks');
    return saved ? JSON.parse(saved) : [];
  }

  setSelectedBooks(books: string[]): void {
    localStorage.setItem('characterSelectedBooks', JSON.stringify(books));
  }

  getSelectedCasts(): string[] {
    const saved = localStorage.getItem('characterSelectedCasts');
    return saved ? JSON.parse(saved) : [];
  }

  setSelectedCasts(casts: string[]): void {
    localStorage.setItem('characterSelectedCasts', JSON.stringify(casts));
  }

  // Generic get/set with type safety
  get<T>(key: string, defaultValue: T): T {
    const saved = localStorage.getItem(key);
    if (!saved) return defaultValue;
    try {
      return JSON.parse(saved) as T;
    } catch {
      return saved as any;
    }
  }

  set<T>(key: string, value: T): void {
    localStorage.setItem(key, JSON.stringify(value));
  }

  remove(key: string): void {
    localStorage.removeItem(key);
  }

  clear(): void {
    localStorage.clear();
  }
}
