import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Character } from '../../../../core/interfaces';
import { MetadataHelperService } from '../../../../core/services';
import { ModalFrameComponent } from '../../../../shared/modal-frame/modal-frame.component';

@Component({
  selector: 'app-pin-add-dialog',
  imports: [FormsModule, ModalFrameComponent],
  templateUrl: './pin-add-dialog.component.html',
  styleUrls: ['./pin-add-dialog.component.scss'],
})
export class PinAddDialogComponent implements OnChanges {
  @Input() visible = false;
  @Input() characters: Character[] = [];
  @Input() pinnedCharacterIds: string[] = [];
  @Input() thumbnailDataUrls: Map<string, string> = new Map();

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() characterSelected = new EventEmitter<Character>();

  @ViewChild('characterFilterInput', { static: false }) characterFilterInput!: ElementRef<HTMLInputElement>;

  characterFilter = '';
  filteredCharacters: Character[] = [];
  selectedCharacterIndex = -1;

  constructor(public metadataHelper: MetadataHelperService) {}

  @HostListener('document:keydown', ['$event'])
  handleDialogKeydown(event: KeyboardEvent): void {
    if (!this.visible) return;
    if (event.key === 'Escape') return; // ModalFrame handles Esc close

    const target = event.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.navigateCharacterList(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.navigateCharacterList(-1);
    } else if (event.key === 'Enter' && isInput) {
      event.preventDefault();
      this.selectHighlightedCharacter();
    }
  }

  ngOnChanges(): void {
    if (this.visible) {
      this.characterFilter = '';
      this.selectedCharacterIndex = -1;
      this.updateFilteredCharacters();
      setTimeout(() => {
        this.characterFilterInput?.nativeElement.focus();
      }, 0);
    }
  }

  onClose(): void {
    this.visible = false;
    this.visibleChange.emit(false);
    this.characterFilter = '';
    this.filteredCharacters = [];
    this.selectedCharacterIndex = -1;
  }

  onFilterInput(): void {
    this.updateFilteredCharacters();
  }

  onCharacterClick(character: Character): void {
    this.characterSelected.emit(character);
  }

  getThumbnailDataUrl(character: Character): string | null {
    return this.thumbnailDataUrls.get(character.id) || null;
  }

  updateFilteredCharacters(): void {
    let availableCharacters = this.characters.filter(
      (char) => !this.pinnedCharacterIds.includes(char.id)
    );

    if (this.characterFilter.trim()) {
      const filter = this.characterFilter.toLowerCase();
      availableCharacters = availableCharacters.filter(
        (char) =>
          char.name.toLowerCase().includes(filter) ||
          char.category.toLowerCase().includes(filter)
      );
    }

    this.filteredCharacters = availableCharacters;

    if (this.selectedCharacterIndex >= this.filteredCharacters.length) {
      this.selectedCharacterIndex =
        this.filteredCharacters.length > 0 ? this.filteredCharacters.length - 1 : -1;
    }
  }

  private navigateCharacterList(direction: number): void {
    if (this.filteredCharacters.length === 0) {
      this.selectedCharacterIndex = -1;
      return;
    }

    this.selectedCharacterIndex += direction;

    if (this.selectedCharacterIndex < 0) {
      this.selectedCharacterIndex = 0;
    } else if (this.selectedCharacterIndex >= this.filteredCharacters.length) {
      this.selectedCharacterIndex = this.filteredCharacters.length - 1;
    }

    this.scrollToSelectedCharacter();
  }

  private selectHighlightedCharacter(): void {
    if (
      this.selectedCharacterIndex >= 0 &&
      this.selectedCharacterIndex < this.filteredCharacters.length
    ) {
      this.characterSelected.emit(this.filteredCharacters[this.selectedCharacterIndex]);
    }
  }

  private scrollToSelectedCharacter(): void {
    setTimeout(() => {
      const selectedElement = document.querySelector('.character-item.selected') as HTMLElement;
      selectedElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }, 0);
  }
}
