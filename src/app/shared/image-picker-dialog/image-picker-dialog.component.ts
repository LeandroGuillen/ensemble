import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  NgZone,
  OnDestroy,
  OnInit,
  Output,
  DestroyRef,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { ProjectImage } from '../../core/interfaces';
import { ImagePickerService } from '../../core/services/image-picker.service';
import { ElectronService } from '../../core/services/electron.service';

@Component({
  selector: 'app-image-picker-dialog',
  imports: [FormsModule, AsyncPipe],
  templateUrl: './image-picker-dialog.component.html',
  styleUrls: ['./image-picker-dialog.component.scss'],
})
export class ImagePickerDialogComponent implements OnInit, OnDestroy {
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() imageSelected = new EventEmitter<ProjectImage>();
  @Output() closed = new EventEmitter<void>();
  @Output() explorerError = new EventEmitter<string>();

  imageSearch = '';
  private readonly destroyRef = inject(DestroyRef);

  private browserNavigationCommandListener = (
    _event: unknown,
    direction: 'back' | 'forward'
  ) => {
    if (!this.visible) return;
    this.ngZone.run(() => {
      this.imagePickerService.handleExternalNavigation(direction);
    });
  };

  constructor(
    readonly imagePickerService: ImagePickerService,
    private electronService: ElectronService,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.electronService.onBrowserNavigationCommand(
      this.browserNavigationCommandListener
    );
    this.imagePickerService.state$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        if (!state.isOpen && this.visible) {
          this.visible = false;
          this.visibleChange.emit(false);
          this.closed.emit();
        }
      });
  }

  ngOnDestroy(): void {
    this.electronService.removeBrowserNavigationCommandListener(
      this.browserNavigationCommandListener
    );
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.visible) return;
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      event.key === 'ArrowLeft'
        ? this.imagePickerService.goBack()
        : this.imagePickerService.goForward();
    }
  }

  onBackdropClick(): void {
    this.close();
  }

  onCloseClick(): void {
    this.close();
  }

  close(): void {
    this.imagePickerService.close();
    this.visible = false;
    this.visibleChange.emit(false);
    this.closed.emit();
  }

  selectImage(image: ProjectImage): void {
    this.imageSelected.emit(image);
    this.close();
  }

  async openInExplorer(): Promise<void> {
    const error = await this.imagePickerService.openCurrentDirectoryInExplorer();
    if (error) {
      this.explorerError.emit(error);
    }
  }
}
