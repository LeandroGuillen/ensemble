import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
  OnDestroy,
  HostListener,
  NgZone,
  ChangeDetectorRef,
} from "@angular/core";
import { Subject, takeUntil } from "rxjs";
import { Cast, Character } from "../../core/interfaces";
import { ElectronService } from "../../core/services";

@Component({
  selector: "app-cast-dropdown",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./cast-dropdown.component.html",
  styleUrls: ["./cast-dropdown.component.scss"],
})
export class CastDropdownComponent implements OnInit, OnDestroy {
  @Input() casts: Cast[] = [];
  @Input() characters: Character[] = [];
  @Input() selectedCastId: string = "";
  @Input() label: string = "Cast:";
  @Input() allLabel: string = "All Characters";
  @Input() showCharacterThumbnails: boolean = true; // Whether to show character thumbnails in collage

  @Output() castChange = new EventEmitter<string>();

  private destroy$ = new Subject<void>();

  isDropdownOpen = false;
  characterThumbnailDataUrls: Map<string, string> = new Map();

  constructor(
    private electronService: ElectronService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (this.showCharacterThumbnails) {
      this.loadCharacterThumbnails();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener("document:click", ["$event"])
  handleDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    const dropdown = target.closest(".cast-dropdown-container");

    if (!dropdown && this.isDropdownOpen) {
      this.isDropdownOpen = false;
    }
  }

  toggleDropdown(): void {
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  selectCast(castId: string): void {
    this.selectedCastId = castId;
    this.isDropdownOpen = false;
    this.castChange.emit(castId);
  }

  getSelectedCast(): Cast | null {
    if (!this.selectedCastId) return null;
    return this.casts.find((cast) => cast.id === this.selectedCastId) || null;
  }

  getCastDisplayText(cast: Cast | null): string {
    if (!cast) return "";
    return cast.name.substring(0, 4).toUpperCase();
  }

  getCastThumbnailCollage(cast: Cast | null): string[] {
    if (!cast || !this.showCharacterThumbnails) return [];

    // Get characters in this cast that have thumbnails
    const castCharacters = this.characters
      .filter((char) => cast.characterIds.includes(char.id))
      .filter((char) => this.characterThumbnailDataUrls.has(char.id));

    // Get up to 4 thumbnails
    return castCharacters
      .slice(0, 4)
      .map((char) => this.characterThumbnailDataUrls.get(char.id)!)
      .filter(Boolean);
  }

  getCastCharacterCount(cast: Cast): number {
    return cast.characterIds.length;
  }

  private async loadCharacterThumbnails(): Promise<void> {
    await this.ngZone.runOutsideAngular(async () => {
      const thumbnailPromises = this.characters
        .filter(
          (char) =>
            char.thumbnail &&
            char.folderPath &&
            !this.characterThumbnailDataUrls.has(char.id)
        )
        .map(async (character) => {
          try {
            const thumbnailPath = `${character.folderPath}/${character.thumbnail}`;
            const dataUrl = await this.electronService.getImageAsDataUrl(
              thumbnailPath
            );
            if (dataUrl) {
              this.characterThumbnailDataUrls.set(character.id, dataUrl);
            }
          } catch (error) {
            console.error(
              `Failed to load thumbnail for character ${character.name}:`,
              error
            );
          }
        });

      await Promise.all(thumbnailPromises);
    });

    this.ngZone.run(() => {
      this.cdr.detectChanges();
    });
  }
}
