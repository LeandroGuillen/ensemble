import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Pinboard } from '../../core/interfaces/pinboard.interface';
import { ProjectService } from '../../core/services/project.service';
import { PinboardService } from '../../core/services/pinboard.service';

@Component({
  selector: 'app-pinboard-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pinboard-sidebar.component.html',
  styleUrls: ['./pinboard-sidebar.component.scss']
})
export class PinboardSidebarComponent implements OnInit, OnDestroy {
  @Output() createPinboard = new EventEmitter<void>();
  @Output() renamePinboard = new EventEmitter<string>();
  @Output() deletePinboard = new EventEmitter<string>();

  pinboards: Pinboard[] = [];
  currentPinboardId: string | null = null;
  contextMenuPinboardId: string | null = null;
  contextMenuPosition: { x: number; y: number } | null = null;

  private subscriptions = new Subscription();

  constructor(
    private projectService: ProjectService,
    private pinboardService: PinboardService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Subscribe to pinboard list changes
    this.subscriptions.add(
      this.projectService.currentProject$.subscribe(() => {
        this.loadPinboards();
      })
    );

    // Subscribe to current pinboard ID changes
    this.subscriptions.add(
      this.pinboardService.currentPinboardId$.subscribe(id => {
        this.currentPinboardId = id;
      })
    );

    this.loadPinboards();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
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

