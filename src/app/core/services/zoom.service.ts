import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const STORAGE_KEY = 'app-zoom-level';
const MIN_LEVEL = -3;
const MAX_LEVEL = 3;
const DEFAULT_LEVEL = 0;

@Injectable({
  providedIn: 'root'
})
export class ZoomService {
  private zoomLevelSubject = new BehaviorSubject<number>(DEFAULT_LEVEL);
  zoomLevel$ = this.zoomLevelSubject.asObservable();

  constructor() {
    if (this.isElectron()) {
      this.applySavedZoom();
    }
  }

  isElectron(): boolean {
    return !!(typeof window !== 'undefined' && (window as any).require);
  }

  get zoomLevel(): number {
    return this.zoomLevelSubject.value;
  }

  getZoomPercent(): number {
    const level = this.zoomLevelSubject.value;
    return Math.round(100 * Math.pow(1.2, level));
  }

  zoomIn(): void {
    if (!this.isElectron()) return;
    const next = Math.min(this.zoomLevelSubject.value + 1, MAX_LEVEL);
    this.setZoomLevel(next);
  }

  zoomOut(): void {
    if (!this.isElectron()) return;
    const next = Math.max(this.zoomLevelSubject.value - 1, MIN_LEVEL);
    this.setZoomLevel(next);
  }

  resetZoom(): void {
    this.setZoomLevel(DEFAULT_LEVEL);
  }

  canZoomIn(): boolean {
    return this.zoomLevelSubject.value < MAX_LEVEL;
  }

  canZoomOut(): boolean {
    return this.zoomLevelSubject.value > MIN_LEVEL;
  }

  private setZoomLevel(level: number): void {
    if (!this.isElectron()) return;
    const { webFrame } = (window as any).require('electron');
    webFrame.setZoomLevel(level);
    this.zoomLevelSubject.next(level);
    try {
      localStorage.setItem(STORAGE_KEY, String(level));
    } catch {
      // ignore
    }
  }

  private applySavedZoom(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, parseInt(saved, 10)));
        if (!Number.isNaN(level)) {
          this.setZoomLevel(level);
          return;
        }
      }
    } catch {
      // ignore
    }
    this.setZoomLevel(DEFAULT_LEVEL);
  }
}
