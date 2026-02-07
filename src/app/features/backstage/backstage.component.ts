import { Component, OnInit, OnDestroy, HostListener, SecurityContext } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import { Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { BackstageService } from "../../core/services/backstage.service";
import { ElectronService } from "../../core/services/electron.service";
import { LoggingService } from "../../core/services/logging.service";
import {
  CharacterConcept,
  NameList,
} from "../../core/interfaces/backstage.interface";
import { PageHeaderComponent } from "../../shared/page-header/page-header.component";

@Component({
  selector: "app-backstage",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
  ],
  templateUrl: "./backstage.component.html",
  styleUrls: ["./backstage.component.scss"],
})
export class BackstageComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  concepts: CharacterConcept[] = [];
  nameLists: NameList[] = [];
  isLoading = false;
  error: string | null = null;

  // Focused editing mode state
  focusedItemType: "concept" | "nameList" | null = null;
  focusedItemIndex: number | null = null;
  focusedNameIndex: number | null = null;
  selectedItemIndex: number | null = null; // For keyboard navigation in overview mode
  selectedSection: "concepts" | "nameLists" = "concepts"; // Which section is selected
  activeTab: "concepts" | "nameLists" = "concepts"; // Which tab is currently active
  
  // Selection state for master-detail view
  selectedConceptIndex: number | null = null;
  selectedNameListIndex: number | null = null;

  // Search and filter
  searchQuery = "";
  filteredConcepts: CharacterConcept[] = [];
  filteredNameLists: NameList[] = [];

  // Name list editing state
  editingNameListIndex: number | null = null;

  // Concept editing state
  editingConceptTitleIndex: number | null = null;
  editingConceptNotes = false;

  // Name editing state
  editingNameIndex: number | null = null;
  editingCommentIndex: number | null = null;
  selectedNameIndex: number | null = null;
  showSorted = false; // Toggle for sorted view of names

  constructor(
    private backstageService: BackstageService,
    private router: Router,
    private electronService: ElectronService,
    private sanitizer: DomSanitizer,
    private logger: LoggingService
  ) {}

  ngOnInit(): void {
    // Load saved active tab from localStorage
    const savedTab = localStorage.getItem('backstageActiveTab') as "concepts" | "nameLists" | null;
    if (savedTab === "concepts" || savedTab === "nameLists") {
      this.activeTab = savedTab;
      this.selectedSection = savedTab;
    }
    
    // Initialize filtered arrays
    this.filteredConcepts = [];
    this.filteredNameLists = [];
    
    this.backstageService
      .getBackstageData()
      .pipe(takeUntil(this.destroy$))
      .subscribe((data) => {
        this.concepts = data.concepts;
        this.nameLists = data.nameLists;
        this.applyFilter();
      });
  }

  applyFilter(): void {
    const query = this.searchQuery.toLowerCase().trim();
    
    if (!query) {
      this.filteredConcepts = this.concepts;
      this.filteredNameLists = this.nameLists;
      return;
    }

    // Filter concepts
    this.filteredConcepts = this.concepts.filter((concept) => {
      const titleMatch = concept.title?.toLowerCase().includes(query) ?? false;
      const notesMatch = concept.notes.toLowerCase().includes(query);
      return titleMatch || notesMatch;
    });

    // Filter name lists
    this.filteredNameLists = this.nameLists.filter((list) => {
      const titleMatch = list.title.toLowerCase().includes(query);
      const namesMatch = list.names.some((nameItem) =>
        nameItem.name.toLowerCase().includes(query) ||
        nameItem.notes?.toLowerCase().includes(query)
      );
      return titleMatch || namesMatch;
    });
  }

  onSearchChange(): void {
    this.applyFilter();
    // Reset selection when searching
    this.selectedItemIndex = null;
  }

  clearSearch(): void {
    this.searchQuery = "";
    this.applyFilter();
  }

  setActiveTab(tab: "concepts" | "nameLists"): void {
    this.activeTab = tab;
    this.selectedSection = tab;
    this.selectedItemIndex = null;
    // Save active tab to localStorage
    localStorage.setItem('backstageActiveTab', tab);
    // Exit focus mode when switching tabs
    if (this.focusedItemType !== null) {
      this.exitFocusMode();
    }
    // Clear selection when switching tabs
    this.selectedConceptIndex = null;
    this.selectedNameListIndex = null;
    // Clear editing state
    this.editingConceptTitleIndex = null;
    this.editingConceptNotes = false;
    this.editingNameIndex = null;
    this.editingCommentIndex = null;
    this.selectedNameIndex = null;
    this.editingNameListIndex = null;
  }

  selectConcept(index: number): void {
    this.selectedConceptIndex = index;
    this.selectedItemIndex = this.filteredConcepts.findIndex(
      (c) => this.concepts.indexOf(c) === index
    );
  }

  selectNameList(index: number): void {
    this.selectedNameListIndex = index;
    this.selectedItemIndex = this.filteredNameLists.findIndex(
      (n) => this.nameLists.indexOf(n) === index
    );
    // Reset name editing state when selecting a different list
    this.editingNameIndex = null;
    this.editingCommentIndex = null;
    this.selectedNameIndex = null;
    
    // Focus the names panel so keyboard navigation works
    setTimeout(() => {
      const panel = document.querySelector('.names-panel') as HTMLElement;
      if (panel) {
        panel.focus();
      }
    }, 0);
  }

  onNamesPanelFocus(): void {
    // Initialize selection to first item if nothing is selected
    if (this.selectedNameIndex === null && this.getSelectedNameList()?.names.length) {
      this.selectedNameIndex = 0;
      this.scrollToSelectedName();
    }
  }

  onNamesPanelClick(event: MouseEvent): void {
    // If clicking on the panel itself (not on a child element that handles its own clicks), focus it
    const target = event.target as HTMLElement;
    if (target.classList.contains("names-panel") || target.classList.contains("names-list-container")) {
      target.focus();
    }
  }

  getSelectedConcept(): CharacterConcept | null {
    if (this.selectedConceptIndex === null || this.selectedConceptIndex < 0 || 
        this.selectedConceptIndex >= this.concepts.length) {
      return null;
    }
    return this.concepts[this.selectedConceptIndex];
  }

  getSelectedNameList(): NameList | null {
    if (this.selectedNameListIndex === null || this.selectedNameListIndex < 0 || 
        this.selectedNameListIndex >= this.nameLists.length) {
      return null;
    }
    return this.nameLists[this.selectedNameListIndex];
  }

  // Get names for display (sorted if showSorted is enabled)
  getDisplayNames(): Array<{ name: string; notes?: string }> | undefined {
    const nameList = this.getSelectedNameList();
    if (!nameList) return undefined;
    
    if (this.showSorted) {
      // Return sorted copy (don't modify original)
      return [...nameList.names].sort((a, b) => {
        // Remove strikethrough markers for sorting
        const nameA = a.name.replace(/^~~|~~$/g, '').toLowerCase();
        const nameB = b.name.replace(/^~~|~~$/g, '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
    }
    return nameList.names;
  }

  // Get the actual index in the original array from the display index
  getOriginalIndex(displayIndex: number): number {
    const nameList = this.getSelectedNameList();
    if (!nameList || !this.showSorted) return displayIndex;
    
    const sortedNames = this.getDisplayNames();
    if (!sortedNames || displayIndex >= sortedNames.length) return displayIndex;
    
    const displayName = sortedNames[displayIndex];
    // Find the original index by comparing the actual object reference
    return nameList.names.findIndex(n => n === displayName);
  }

  toggleSortedView(): void {
    this.showSorted = !this.showSorted;
    // Reset selection when toggling sort
    this.selectedNameIndex = null;
  }

  newNameInput = "";

  onNameItemChange(index: number, field: "name" | "notes", value: string): void {
    if (this.selectedNameListIndex === null) return;
    
    const nameList = this.getSelectedNameList();
    if (!nameList) return;

    const names = [...nameList.names];
    if (field === "name") {
      names[index] = { ...names[index], name: value.trim() };
    } else {
      // Add tab character prefix to comments when storing
      const trimmedValue = value.trim();
      names[index] = { ...names[index], notes: trimmedValue ? `\t${trimmedValue}` : undefined };
    }

    this.updateNameList(this.selectedNameListIndex, { names });
  }

  onRemoveNameItem(index: number): void {
    if (this.selectedNameListIndex === null) return;
    
    const nameList = this.getSelectedNameList();
    if (!nameList) return;

    const names = nameList.names.filter((_, i) => i !== index);
    this.updateNameList(this.selectedNameListIndex, { names });
  }

  onAddNameToSelectedList(): void {
    if (this.selectedNameListIndex === null || !this.newNameInput.trim()) return;
    
    const nameList = this.getSelectedNameList();
    if (!nameList) return;

    const names = [...nameList.names, { name: this.newNameInput.trim() }];
    this.updateNameList(this.selectedNameListIndex, { names });
    this.newNameInput = "";
    
    // Select the newly added name and focus the add input again
    setTimeout(() => {
      const nameList = this.getSelectedNameList();
      if (nameList && nameList.names.length > 0) {
        this.selectedNameIndex = nameList.names.length - 1;
      }
      const input = document.querySelector('.add-name-input') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 0);
  }

  onEscapeAddName(): void {
    // Clear the input and return focus to the names panel
    this.newNameInput = "";
    const panel = document.querySelector('.names-panel') as HTMLElement;
    if (panel) {
      panel.focus();
    }
    // Optionally select the first item if there are any
    const nameList = this.getSelectedNameList();
    if (nameList && nameList.names.length > 0) {
      this.selectedNameIndex = 0;
      this.scrollToSelectedName();
    }
  }

  selectNameItem(index: number): void {
    // Only select if not currently editing
    if (this.editingNameIndex === null && this.editingCommentIndex === null) {
      this.selectedNameIndex = index;
      // Return focus to panel so keyboard navigation works
      const panel = document.querySelector('.names-panel') as HTMLElement;
      if (panel) {
        panel.focus();
      }
    }
  }

  scrollToSelectedName(): void {
    // Scroll the selected name item into view
    if (this.selectedNameIndex === null) return;
    
    setTimeout(() => {
      const nameItems = document.querySelectorAll('.name-item');
      if (nameItems && nameItems.length > this.selectedNameIndex!) {
        const selectedItem = nameItems[this.selectedNameIndex!] as HTMLElement;
        if (selectedItem) {
          selectedItem.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'nearest'
          });
        }
      }
    }, 0);
  }

  // Concept editing methods
  startEditConceptTitle(index: number): void {
    this.editingConceptTitleIndex = index;
    // Focus the input after view updates
    setTimeout(() => {
      const input = document.querySelector('.concept-title-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  onConceptTitleBlur(index: number, value: string): void {
    this.updateConcept(index, { title: value.trim() || "" });
    this.editingConceptTitleIndex = null;
  }

  cancelEditConceptTitle(): void {
    this.editingConceptTitleIndex = null;
  }

  // Name list editing methods
  startEditNameList(index: number): void {
    this.editingNameListIndex = index;
    // Focus the input after view updates
    setTimeout(() => {
      const input = document.querySelector('.item-title-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  onNameListTitleBlur(index: number, value: string): void {
    this.updateNameList(index, { title: value.trim() || "New List" });
    this.editingNameListIndex = null;
  }

  cancelEditNameList(): void {
    this.editingNameListIndex = null;
  }

  // Name editing methods
  startEditName(index: number): void {
    this.editingNameIndex = index;
    this.selectedNameIndex = index;
    setTimeout(() => {
      const input = document.querySelector('.name-input-inline') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  startEditNameComment(index: number): void {
    this.editingCommentIndex = index;
    this.editingNameIndex = null;
    setTimeout(() => {
      const input = document.querySelector('.comment-input-inline') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  // Helper to strip tab character prefix from comments for display/editing
  getCommentForDisplay(notes: string | undefined): string {
    if (!notes) return '';
    // Strip leading tab character if present
    return notes.startsWith('\t') ? notes.substring(1) : notes;
  }

  // Helper to format name for display (render markdown strikethrough)
  formatNameForDisplay(name: string | undefined): string {
    if (!name) return 'Unnamed';
    // Escape HTML to prevent XSS
    const escaped = name
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Convert markdown strikethrough (~~text~~) to HTML
    return escaped.replace(/~~(.+?)~~/g, '<del>$1</del>');
  }

  // Convert markdown to HTML for rendering
  renderMarkdown(markdown: string | undefined): SafeHtml {
    if (!markdown) return '';
    
    // Escape HTML first to prevent XSS
    let html = markdown
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Convert markdown to HTML (basic support)
    // Code blocks (must come before inline code and other formatting)
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    
    // Inline code (must come before bold/italic)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    
    // Italic (simple approach - single asterisk/underscore)
    html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<em>$1</em>');
    
    // Strikethrough
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // Line breaks - convert double newlines to paragraphs
    const paragraphs = html.split(/\n\n+/);
    html = paragraphs.map(para => {
      para = para.trim();
      if (!para) return '';
      // Convert single newlines to <br> within paragraphs
      para = para.replace(/\n/g, '<br>');
      // Don't wrap if already has block-level tags
      if (/^<(h[1-6]|pre|ul|ol)/.test(para)) {
        return para;
      }
      return `<p>${para}</p>`;
    }).join('');
    
    // Sanitize and return as SafeHtml
    const sanitized = this.sanitizer.sanitize(SecurityContext.HTML, html);
    return this.sanitizer.bypassSecurityTrustHtml(sanitized || '');
  }

  toggleEditNotes(): void {
    this.editingConceptNotes = !this.editingConceptNotes;
    if (this.editingConceptNotes) {
      // Focus the textarea after view updates
      setTimeout(() => {
        const textarea = document.querySelector('.notes-textarea') as HTMLTextAreaElement;
        if (textarea) {
          textarea.focus();
        }
      }, 0);
    }
  }

  // Toggle strikethrough on selected name
  toggleStrikethrough(index: number): void {
    if (this.selectedNameListIndex === null) return;
    
    const nameList = this.getSelectedNameList();
    if (!nameList) return;

    const names = [...nameList.names];
    const currentName = names[index].name;
    
    // Check if already has strikethrough
    if (currentName.startsWith('~~') && currentName.endsWith('~~') && currentName.length > 4) {
      // Remove strikethrough
      names[index] = { ...names[index], name: currentName.substring(2, currentName.length - 2) };
    } else {
      // Add strikethrough
      names[index] = { ...names[index], name: `~~${currentName}~~` };
    }

    this.updateNameList(this.selectedNameListIndex, { names });
  }

  finishEditName(): void {
    this.editingNameIndex = null;
    // Return focus to panel so UP/DOWN still work
    setTimeout(() => {
      const panel = document.querySelector('.names-panel') as HTMLElement;
      if (panel) {
        panel.focus();
      }
    }, 0);
  }

  finishEditComment(): void {
    this.editingCommentIndex = null;
    // Return focus to panel so UP/DOWN still work
    setTimeout(() => {
      const panel = document.querySelector('.names-panel') as HTMLElement;
      if (panel) {
        panel.focus();
      }
    }, 0);
  }


  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async addConcept(): Promise<void> {
    try {
      await this.backstageService.addConcept({
        title: "",
        notes: "",
      });
      // Select the newly added concept
      this.selectedConceptIndex = this.concepts.length - 1;
    } catch (error) {
      this.error = `Failed to add concept: ${error}`;
      this.logger.error("Failed to add concept:", error);
    }
  }

  async updateConcept(
    index: number,
    updates: Partial<CharacterConcept>
  ): Promise<void> {
    try {
      await this.backstageService.updateConcept(index, updates);
    } catch (error) {
      this.error = `Failed to update concept: ${error}`;
      this.logger.error("Failed to update concept:", error);
    }
  }

  async deleteConcept(index: number): Promise<void> {
    if (confirm("Are you sure you want to delete this concept?")) {
      try {
        await this.backstageService.deleteConcept(index);
        // Clear selection if deleted item was selected
        if (this.selectedConceptIndex === index) {
          this.selectedConceptIndex = null;
        } else if (this.selectedConceptIndex !== null && this.selectedConceptIndex > index) {
          this.selectedConceptIndex--;
        }
      } catch (error) {
        this.error = `Failed to delete concept: ${error}`;
        this.logger.error("Failed to delete concept:", error);
      }
    }
  }

  async takeTheStage(concept: CharacterConcept): Promise<void> {
    const name = concept.title || "";
    this.router.navigate(["/character/new"], {
      queryParams: { name: name },
    });
  }

  async addNameList(): Promise<void> {
    try {
      await this.backstageService.addNameList({
        title: "New List",
        names: [], // Will be normalized to NameWithNotes[] in service
      });
      // Select the newly added name list
      this.selectedNameListIndex = this.nameLists.length - 1;
    } catch (error) {
      this.error = `Failed to add name list: ${error}`;
      this.logger.error("Failed to add name list:", error);
    }
  }

  async updateNameList(
    index: number,
    updates: Partial<NameList>
  ): Promise<void> {
    try {
      await this.backstageService.updateNameList(index, updates);
    } catch (error) {
      this.error = `Failed to update name list: ${error}`;
      this.logger.error("Failed to update name list:", error);
    }
  }

  async deleteNameList(index: number): Promise<void> {
    if (confirm("Are you sure you want to delete this name list?")) {
      try {
        await this.backstageService.deleteNameList(index);
        // Clear selection if deleted item was selected
        if (this.selectedNameListIndex === index) {
          this.selectedNameListIndex = null;
        } else if (this.selectedNameListIndex !== null && this.selectedNameListIndex > index) {
          this.selectedNameListIndex--;
        }
      } catch (error) {
        this.error = `Failed to delete name list: ${error}`;
        this.logger.error("Failed to delete name list:", error);
      }
    }
  }

  async takeTheStageWithName(name: string): Promise<void> {
    this.router.navigate(["/character/new"], {
      queryParams: { name: name },
    });
  }

  async reload(): Promise<void> {
    try {
      this.isLoading = true;
      this.error = null;
      await this.backstageService.loadBackstageData();
    } catch (error) {
      this.error = `Failed to reload: ${error}`;
      this.logger.error("Failed to reload backstage data:", error);
    } finally {
      this.isLoading = false;
    }
  }

  // Focused editing mode methods
  enterFocusMode(type: "concept" | "nameList", index: number): void {
    this.focusedItemType = type;
    this.focusedItemIndex = index;
    this.focusedNameIndex = null;
    this.selectedItemIndex = null;
  }

  exitFocusMode(): void {
    this.focusedItemType = null;
    this.focusedItemIndex = null;
    this.focusedNameIndex = null;
  }

  isFocused(type: "concept" | "nameList", index: number): boolean {
    return this.focusedItemType === type && this.focusedItemIndex === index;
  }

  isItemDimmed(type: "concept" | "nameList", index: number): boolean {
    return (
      this.focusedItemType !== null &&
      !(this.focusedItemType === type && this.focusedItemIndex === index)
    );
  }

  // Keyboard navigation
  @HostListener("keydown", ["$event"])
  handleKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
    const isEditingName = this.editingNameIndex !== null;
    const isEditingComment = this.editingCommentIndex !== null;
    
    // Check if we're in an input that should allow arrow key navigation
    const isNameInput = target.classList?.contains("name-input-inline");
    const isCommentInput = target.classList?.contains("comment-input-inline");
    const isAddNameInput = target.classList?.contains("add-name-input");
    const isInEditableInput = isNameInput || isCommentInput || isAddNameInput;
    
    // Handle name navigation and editing when in names panel
    // Only allow navigation when not actively editing a name/comment and not in add inputs
    if (this.activeTab === "nameLists" && this.getSelectedNameList()) {
      const nameList = this.getSelectedNameList();
      
      // Arrow key navigation
      if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !isEditingName && !isEditingComment && !isInEditableInput) {
        if (nameList && nameList.names.length > 0) {
          event.preventDefault();
          const displayNames = this.getDisplayNames();
          if (!displayNames) return;
          
          // Find current display index
          let currentDisplayIndex = -1;
          if (this.selectedNameIndex !== null) {
            if (this.showSorted) {
              currentDisplayIndex = displayNames.findIndex((n, idx) => {
                const origIdx = this.getOriginalIndex(idx);
                return origIdx === this.selectedNameIndex;
              });
            } else {
              currentDisplayIndex = this.selectedNameIndex;
            }
          }
          
          if (event.key === "ArrowUp") {
            if (currentDisplayIndex > 0) {
              currentDisplayIndex = currentDisplayIndex - 1;
            } else if (currentDisplayIndex === 0) {
              currentDisplayIndex = displayNames.length - 1;
            } else {
              // currentDisplayIndex is -1, start from last
              currentDisplayIndex = displayNames.length - 1;
            }
          } else if (event.key === "ArrowDown") {
            if (currentDisplayIndex < displayNames.length - 1) {
              currentDisplayIndex = currentDisplayIndex + 1;
            } else {
              // Wrap to beginning
              currentDisplayIndex = 0;
            }
          }
          
          // Convert display index back to original index
          this.selectedNameIndex = this.getOriginalIndex(currentDisplayIndex);
          
          // Scroll the selected item into view
          this.scrollToSelectedName();
          return;
        }
      }
      
      // ENTER key to edit name
      if (event.key === "Enter" && !isEditingName && !isEditingComment && !isInEditableInput && this.selectedNameIndex !== null) {
        if (nameList && nameList.names.length > 0 && this.selectedNameIndex >= 0 && this.selectedNameIndex < nameList.names.length) {
          event.preventDefault();
          this.startEditName(this.selectedNameIndex);
          return;
        }
      }
      
      // C key to add/edit comment
      if ((event.key === "c" || event.key === "C") && !isEditingName && !isEditingComment && !isInEditableInput && this.selectedNameIndex !== null) {
        if (nameList && nameList.names.length > 0 && this.selectedNameIndex >= 0 && this.selectedNameIndex < nameList.names.length) {
          event.preventDefault();
          this.startEditNameComment(this.selectedNameIndex);
          return;
        }
      }
      
      // S key to toggle strikethrough
      if ((event.key === "s" || event.key === "S") && !isEditingName && !isEditingComment && !isInEditableInput && this.selectedNameIndex !== null && !event.ctrlKey && !event.metaKey) {
        if (nameList && nameList.names.length > 0 && this.selectedNameIndex >= 0 && this.selectedNameIndex < nameList.names.length) {
          event.preventDefault();
          this.toggleStrikethrough(this.selectedNameIndex);
          return;
        }
      }
      
      // DEL or Delete key to delete selected name
      if ((event.key === "Delete" || event.key === "Del") && !isEditingName && !isEditingComment && !isInEditableInput && this.selectedNameIndex !== null) {
        if (nameList && nameList.names.length > 0 && this.selectedNameIndex >= 0 && this.selectedNameIndex < nameList.names.length) {
          event.preventDefault();
          const indexToDelete = this.selectedNameIndex;
          const currentLength = nameList.names.length;
          const wasLastItem = indexToDelete === currentLength - 1;
          this.onRemoveNameItem(indexToDelete);
          // Adjust selected index after deletion
          // The new length will be currentLength - 1
          const newLength = currentLength - 1;
          if (newLength > 0) {
            if (wasLastItem) {
              // If we deleted the last item, select the new last item
              this.selectedNameIndex = newLength - 1;
            } else {
              // Otherwise, keep the same index (next item moves up)
              this.selectedNameIndex = indexToDelete;
            }
          } else {
            // No more items
            this.selectedNameIndex = null;
          }
          return;
        }
      }
      
      // N key to focus add name input
      if ((event.key === "n" || event.key === "N") && !isEditingName && !isEditingComment && !isInEditableInput && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const addInput = document.querySelector('.add-name-input') as HTMLInputElement;
        if (addInput) {
          addInput.focus();
          // Clear selection when focusing add input
          this.selectedNameIndex = null;
        }
        return;
      }
    }

    // Don't handle if user is typing in an input/textarea (except for name navigation above)
    if (isInput && !(this.activeTab === "nameLists" && (event.key === "ArrowUp" || event.key === "ArrowDown") && !isInEditableInput)) {
      // Allow Escape to exit focus mode even when typing
      if (event.key === "Escape" && this.focusedItemType !== null) {
        event.preventDefault();
        this.exitFocusMode();
      }
      return;
    }

    // Handle keyboard shortcuts
    if (event.ctrlKey || event.metaKey) {
      if (event.key === "n" && !event.shiftKey) {
        event.preventDefault();
        this.addConcept();
        return;
      }
      if (event.key === "N" && event.shiftKey) {
        event.preventDefault();
        this.addNameList();
        return;
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        const searchInput = document.querySelector(
          "[data-search-input]"
        ) as HTMLInputElement;
        searchInput?.focus();
        return;
      }
    }

    // Overview mode navigation
    if (this.focusedItemType === null) {
      this.handleOverviewNavigation(event);
    } else {
      // Focused mode navigation
      this.handleFocusedNavigation(event);
    }
  }

  private handleOverviewNavigation(event: KeyboardEvent): void {
    // Use activeTab instead of selectedSection for navigation
    const currentSection =
      this.activeTab === "concepts"
        ? this.filteredConcepts
        : this.filteredNameLists;
    const currentIndex = this.selectedItemIndex ?? -1;

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        if (currentIndex > 0) {
          this.selectedItemIndex = currentIndex - 1;
          // Auto-select when navigating
          if (this.activeTab === "concepts") {
            const concept = this.filteredConcepts[this.selectedItemIndex];
            this.selectConcept(this.concepts.indexOf(concept));
          } else {
            const nameList = this.filteredNameLists[this.selectedItemIndex];
            this.selectNameList(this.nameLists.indexOf(nameList));
          }
        }
        break;
      case "ArrowDown":
        event.preventDefault();
        if (currentIndex < currentSection.length - 1) {
          this.selectedItemIndex = currentIndex + 1;
          // Auto-select when navigating
          if (this.activeTab === "concepts") {
            const concept = this.filteredConcepts[this.selectedItemIndex];
            this.selectConcept(this.concepts.indexOf(concept));
          } else {
            const nameList = this.filteredNameLists[this.selectedItemIndex];
            this.selectNameList(this.nameLists.indexOf(nameList));
          }
        }
        break;
      case "PageUp":
        event.preventDefault();
        const pageUpIndex = Math.max(0, currentIndex - 10);
        this.selectedItemIndex = pageUpIndex;
        if (this.activeTab === "concepts") {
          const concept = this.filteredConcepts[this.selectedItemIndex];
          this.selectConcept(this.concepts.indexOf(concept));
        } else {
          const nameList = this.filteredNameLists[this.selectedItemIndex];
          this.selectNameList(this.nameLists.indexOf(nameList));
        }
        break;
      case "PageDown":
        event.preventDefault();
        const pageDownIndex = Math.min(currentSection.length - 1, currentIndex + 10);
        this.selectedItemIndex = pageDownIndex;
        if (this.activeTab === "concepts") {
          const concept = this.filteredConcepts[this.selectedItemIndex];
          this.selectConcept(this.concepts.indexOf(concept));
        } else {
          const nameList = this.filteredNameLists[this.selectedItemIndex];
          this.selectNameList(this.nameLists.indexOf(nameList));
        }
        break;
      case "Enter":
        event.preventDefault();
        if (currentIndex >= 0 && currentIndex < currentSection.length) {
          if (this.activeTab === "concepts") {
            const concept = this.filteredConcepts[currentIndex];
            this.selectConcept(this.concepts.indexOf(concept));
          } else {
            const nameList = this.filteredNameLists[currentIndex];
            this.selectNameList(this.nameLists.indexOf(nameList));
          }
        }
        break;
      case "Escape":
        event.preventDefault();
        this.selectedItemIndex = null;
        if (this.activeTab === "concepts") {
          this.selectedConceptIndex = null;
        } else {
          this.selectedNameListIndex = null;
        }
        break;
      case "Tab":
        // Switch tabs with Tab key (when not in input)
        if (!event.shiftKey) {
          event.preventDefault();
          this.setActiveTab(this.activeTab === "concepts" ? "nameLists" : "concepts");
        }
        break;
    }
  }

  private handleFocusedNavigation(event: KeyboardEvent): void {
    if (this.focusedItemType === null || this.focusedItemIndex === null) {
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        this.exitFocusMode();
        break;
      case "ArrowUp":
      case "ArrowDown":
      case "PageUp":
      case "PageDown":
        // These will be handled by the focused component
        // We just prevent default to avoid scrolling the page
        if (this.focusedItemType === "nameList") {
          // Let the name list component handle it
          return;
        }
        break;
    }
  }

  onConceptFocus(index: number): void {
    this.enterFocusMode("concept", index);
  }

  onNameListFocus(index: number): void {
    this.enterFocusMode("nameList", index);
  }

  async openConceptsInEditor(): Promise<void> {
    try {
      const projectPath = this.backstageService.getCurrentProjectPath();
      if (!projectPath) {
        this.error = "No project loaded";
        return;
      }
      const filePath = `${projectPath}/characters/concepts.md`;
      const result = await this.electronService.openFileInEditor(filePath);
      if (!result.success) {
        this.error = `Failed to open file: ${result.error}`;
      }
    } catch (error) {
      this.error = `Failed to open file: ${error}`;
      this.logger.error("Failed to open concepts file:", error);
    }
  }

  async openNamesInEditor(): Promise<void> {
    try {
      const projectPath = this.backstageService.getCurrentProjectPath();
      if (!projectPath) {
        this.error = "No project loaded";
        return;
      }
      const filePath = `${projectPath}/characters/names.md`;
      const result = await this.electronService.openFileInEditor(filePath);
      if (!result.success) {
        this.error = `Failed to open file: ${result.error}`;
      }
    } catch (error) {
      this.error = `Failed to open file: ${error}`;
      this.logger.error("Failed to open names file:", error);
    }
  }
}
