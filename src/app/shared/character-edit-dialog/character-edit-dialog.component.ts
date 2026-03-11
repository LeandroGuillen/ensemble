import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, ViewEncapsulation } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CharacterEditDialogService, CharacterEditDialogState } from '../../core/services/character-edit-dialog.service';
import { CharacterDetailComponent } from '../../features/character-detail/character-detail.component';

@Component({
  selector: 'app-character-edit-dialog',
  standalone: true,
  imports: [CommonModule, CharacterDetailComponent],
  templateUrl: './character-edit-dialog.component.html',
  styleUrls: ['./character-edit-dialog.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class CharacterEditDialogComponent implements OnInit, OnDestroy {
  @ViewChild(CharacterDetailComponent) characterDetailRef?: CharacterDetailComponent;

  state: CharacterEditDialogState | null = null;
  private destroy$ = new Subject<void>();

  constructor(private characterEditDialog: CharacterEditDialogService) {}

  ngOnInit(): void {
    this.characterEditDialog.state$
      .pipe(takeUntil(this.destroy$))
      .subscribe((s) => (this.state = s));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onOverlayClick(): void {
    // Delegate to character detail so unsaved-changes confirmation is handled
    this.characterDetailRef?.onCancel();
  }

  onDialogClick(event: Event): void {
    event.stopPropagation();
  }

  onCharacterClosed(): void {
    this.characterEditDialog.close();
  }
}
