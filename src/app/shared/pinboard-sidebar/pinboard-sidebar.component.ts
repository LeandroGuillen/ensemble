import { Component, OnInit, Output, EventEmitter, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Pinboard } from '../../core/interfaces/pinboard.interface';
import { ProjectService } from '../../core/services/project.service';
import { PinboardService } from '../../core/services/pinboard.service';

@Component({
    selector: 'app-pinboard-sidebar',
    imports: [],
    templateUrl: './pinboard-sidebar.component.html',
    styleUrls: ['./pinboard-sidebar.component.scss']
})
export class PinboardSidebarComponent implements OnInit {
  @Output() createPinboard = new EventEmitter<void>();
  @Output() renamePinboard = new EventEmitter<string>();
  @Output() deletePinboard = new EventEmitter<string>();
  @Output() toggleCollapse = new EventEmitter<void>();

  pinboards: Pinboard[] = [];
  currentPinboardId: string | null = null;
  contextMenuPinboardId: string | null = null;
  contextMenuPosition: { x: number; y: number } | null = null;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private projectService: ProjectService,
    private pinboardService: PinboardService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.projectService.currentProject$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.loadPinboards();
      });

    this.pinboardService.currentPinboardId$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(id => {
        this.currentPinboardId = id;
      });

    this.loadPinboards();
  }

  private loadPinboards(): void {
    this.pinboards = this.projectService.getPinboards();
    const currentPinboard = this.projectService.getCurrentPinboard();
    this.currentPinboardId = currentPinboard?.id || null;
  }

  onPinboardSelect(id: string): void {
    if (id !== this.currentPinboardId) {
      this.pinboardService.switchPinboard(id);
    }
  }

  onCreatePinboard(): void {
    this.createPinboard.emit();
  }

  onRenamePinboard(id: string): void {
    this.renamePinboard.emit(id);
    this.closeContextMenu();
  }

  onDeletePinboard(id: string): void {
    this.deletePinboard.emit(id);
    this.closeContextMenu();
  }

  onContextMenu(event: MouseEvent, pinboardId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuPinboardId = pinboardId;
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
  }

  closeContextMenu(): void {
    this.contextMenuPinboardId = null;
    this.contextMenuPosition = null;
  }

  isCurrentPinboard(id: string): boolean {
    return id === this.currentPinboardId;
  }
}
