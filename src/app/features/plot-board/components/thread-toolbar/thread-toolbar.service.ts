import { Injectable } from '@angular/core';

@Injectable()
export class ThreadToolbarService {
  private static readonly TOOLBAR_APPROX_HEIGHT = 36;
  private static readonly TOOLBAR_GAP = 6;

  /** Viewport coords for fixed thread toolbars (escapes page-header stacking context). */
  fixedPos: Record<string, { top: number; left: number }> = {};
  /** Hovered row or toolbar; confirm-delete keeps toolbar without hover. */
  activeThreadId: string | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  private pointerInsideToolbar = false;
  private anchorById = new Map<string, HTMLElement>();

  clearLeaveTimer(): void {
    if (this.leaveTimer) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }

  onNameRowEnter(threadId: string, anchor: HTMLElement): void {
    this.clearLeaveTimer();
    this.pointerInsideToolbar = false;
    this.activeThreadId = threadId;
    this.anchorById.set(threadId, anchor);
    this.layout(threadId, anchor);
  }

  onNameRowLeave(
    threadId: string,
    confirmDeleteThreadId: string | null,
    showThreadColorPicker: string | null
  ): void {
    if (confirmDeleteThreadId === threadId || showThreadColorPicker === threadId) {
      return;
    }
    this.leaveTimer = setTimeout(() => {
      if (!this.pointerInsideToolbar && this.activeThreadId === threadId) {
        this.activeThreadId = null;
        this.anchorById.delete(threadId);
      }
      this.leaveTimer = null;
    }, 200);
  }

  onToolbarMouseEnter(threadId: string): void {
    this.clearLeaveTimer();
    this.pointerInsideToolbar = true;
    this.activeThreadId = threadId;
    const anchor = this.anchorById.get(threadId);
    if (anchor) {
      this.layout(threadId, anchor);
    }
  }

  onToolbarMouseLeave(
    threadId: string,
    confirmDeleteThreadId: string | null,
    showThreadColorPicker: string | null
  ): void {
    this.pointerInsideToolbar = false;
    if (confirmDeleteThreadId === threadId || showThreadColorPicker === threadId) {
      return;
    }
    this.onNameRowLeave(threadId, confirmDeleteThreadId, showThreadColorPicker);
  }

  isVisible(threadId: string, confirmDeleteThreadId: string | null, showThreadColorPicker: string | null): boolean {
    return (
      this.activeThreadId === threadId ||
      confirmDeleteThreadId === threadId ||
      showThreadColorPicker === threadId
    );
  }

  getTop(threadId: string): number {
    return this.fixedPos[threadId]?.top ?? 0;
  }

  getLeft(threadId: string): number {
    return this.fixedPos[threadId]?.left ?? 0;
  }

  refreshActiveLayout(
    confirmDeleteThreadId: string | null,
    showThreadColorPicker: string | null
  ): void {
    const id = this.activeThreadId ?? confirmDeleteThreadId ?? showThreadColorPicker;
    if (!id) return;
    const anchor = this.anchorById.get(id);
    if (anchor) {
      this.layout(id, anchor);
    }
  }

  registerAnchorForColorPicker(threadId: string): void {
    this.activeThreadId = threadId;
    const anchor = this.anchorById.get(threadId);
    if (anchor) {
      this.layout(threadId, anchor);
    }
  }

  destroy(): void {
    this.clearLeaveTimer();
  }

  private layout(threadId: string, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const h = ThreadToolbarService.TOOLBAR_APPROX_HEIGHT;
    const gap = ThreadToolbarService.TOOLBAR_GAP;
    const top = rect.top - h - gap;
    const left = rect.left + rect.width / 2;
    this.fixedPos[threadId] = { top, left };
  }
}
