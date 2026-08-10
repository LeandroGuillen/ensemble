import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { Observable, Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { Character, Pinboard, PinboardConnection } from '../../core/interfaces';
import { DEFAULT_CONNECTION_COLOR } from '../../core/constants/project.constants';
import {
  CharacterService,
  ProjectService,
  PinboardService,
  LoggingService,
  NotificationService,
  ModalService,
  CharacterEditDialogService,
} from '../../core/services';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { PinboardSidebarComponent } from '../../shared/pinboard-sidebar/pinboard-sidebar.component';
import { PinboardCreateDialogComponent } from '../../shared/pinboard-create-dialog/pinboard-create-dialog.component';
import { PinboardRenameDialogComponent } from '../../shared/pinboard-rename-dialog/pinboard-rename-dialog.component';
import { PinboardNetworkService } from './pinboard-network.service';
import { PinboardCanvasInteractionService } from './pinboard-canvas-interaction.service';
import { ConnectionFormData, createEmptyConnectionForm } from './pinboard-connection-form';
import { PinboardToolbarComponent } from './components/pinboard-toolbar/pinboard-toolbar.component';
import { PinAddDialogComponent } from './components/pin-add-dialog/pin-add-dialog.component';
import { ConnectionEditDialogComponent } from './components/connection-edit-dialog/connection-edit-dialog.component';

@Component({
  selector: 'app-pinboard-view',
  imports: [
    PageHeaderComponent,
    PinboardSidebarComponent,
    PinboardCreateDialogComponent,
    PinboardRenameDialogComponent,
    PinboardToolbarComponent,
    PinAddDialogComponent,
    ConnectionEditDialogComponent,
  ],
  providers: [PinboardNetworkService, PinboardCanvasInteractionService],
  templateUrl: './pinboard-view.component.html',
  styleUrls: ['./pinboard-view.component.scss'],
  animations: [
    trigger('pinboardSidebar', [
      state('open', style({ width: '240px' })),
      state('closed', style({ width: '0', overflow: 'hidden' })),
      transition('open <=> closed', [
        animate('240ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'),
      ]),
    ]),
  ],
})
export class PinboardViewComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('pinboardContainer', { static: true }) pinboardContainer!: ElementRef;

  pinboardData$ = this.pinboardService.getPinboardData();
  characters$ = this.characterService.getCharacters();

  private subscriptions = new Subscription();

  sidebarOpen = true;
  showConnectionDialog = false;
  showEditDialog = false;
  showAddPinDialog = false;
  characters: Character[] = [];
  thumbnailDataUrls: Map<string, string> = new Map();

  connectionForm: ConnectionFormData = createEmptyConnectionForm();
  editingConnection: PinboardConnection | null = null;

  showCreatePinboardDialog = false;
  showRenamePinboardDialog = false;
  pinboardToRename: string | null = null;
  currentPinboard: Pinboard | null = null;
  pinboards: Pinboard[] = [];

  constructor(
    private pinboardService: PinboardService,
    private characterService: CharacterService,
    private projectService: ProjectService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
    private logger: LoggingService,
    private notificationService: NotificationService,
    private modalService: ModalService,
    private characterEditDialog: CharacterEditDialogService,
    readonly networkService: PinboardNetworkService,
    readonly interactionService: PinboardCanvasInteractionService
  ) {}

  get isEmpty(): boolean {
    return this.networkService.isEmpty;
  }

  get networkInitialized(): boolean {
    return this.networkService.networkInitialized;
  }

  get pinnedCharacterIds(): string[] {
    return this.pinboardService.getCurrentPinboardDataSnapshot().nodes.map(node => node.id);
  }

  ngOnInit(): void {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      this.logger.error('No project loaded in pinboard view!');
      return;
    }

    this.loadCharactersIfNeeded();
    this.subscribeToData();
    this.subscribeToPinboardChanges();
    this.loadPinboards();
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.initializePinboard();
      this.refreshPinboardData();
      this.networkService.restoreViewState();
    }, 0);
  }

  ngOnDestroy(): void {
    this.networkService.saveViewState();
    this.interactionService.detach();
    this.networkService.destroy();
    this.subscriptions.unsubscribe();
  }

  @HostListener('document:keydown.escape', ['$event'])
  handleEscapeKey(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (this.interactionService.connectionMode) {
      keyboardEvent.preventDefault();
      this.interactionService.exitConnectionMode();
    } else if (
      this.showAddPinDialog ||
      this.showConnectionDialog ||
      this.showEditDialog
    ) {
      keyboardEvent.preventDefault();
      this.closeDialogs();
    }
  }

  @HostListener('document:keydown.p', ['$event'])
  handlePKey(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    const target = keyboardEvent.target as HTMLElement;
    const isInput =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable;

    if (
      !isInput &&
      !this.showAddPinDialog &&
      !this.showConnectionDialog &&
      !this.showEditDialog &&
      !this.showCreatePinboardDialog &&
      !this.showRenamePinboardDialog &&
      !this.interactionService.connectionMode
    ) {
      keyboardEvent.preventDefault();
      this.openAddPinDialog();
    }
  }

  onZoomIn(): void {
    this.networkService.zoomIn();
    this.cdr.detectChanges();
  }

  onZoomOut(): void {
    this.networkService.zoomOut();
    this.cdr.detectChanges();
  }

  onResetView(): void {
    this.networkService.resetView();
  }

  onToggleGrid(): void {
    this.networkService.toggleGrid();
    this.cdr.detectChanges();
  }

  onToggleSnapToGrid(): void {
    this.networkService.toggleSnapToGrid();
    this.cdr.detectChanges();
  }

  onPlusIconClick(event: MouseEvent): void {
    this.interactionService.onPlusIconClick(event);
    this.cdr.detectChanges();
  }

  exitConnectionMode(): void {
    this.interactionService.exitConnectionMode();
    this.cdr.detectChanges();
  }

  openAddPinDialog(): void {
    this.showAddPinDialog = true;
  }

  closeDialogs(): void {
    this.showConnectionDialog = false;
    this.showEditDialog = false;
    this.showAddPinDialog = false;
    this.editingConnection = null;
    this.connectionForm = createEmptyConnectionForm();
    this.interactionService.exitConnectionMode();
  }

  async onCharacterSelected(character: Character): Promise<void> {
    try {
      await this.pinboardService.addPin(character, this.networkService.gridSize);
      this.closeDialogs();
    } catch (error) {
      this.logger.error('Failed to add character to pinboard:', error);
      this.notificationService.showError(`Failed to add character to pinboard: ${error}`);
    }
  }

  onConnectionSave(form: ConnectionFormData): void {
    this.connectionForm = form;
    void this.saveConnection();
  }

  private async saveConnection(): Promise<void> {
    try {
      const connectionData: Omit<PinboardConnection, 'id'> = {
        source: this.connectionForm.source,
        target: this.connectionForm.target,
        type: '',
        label: this.connectionForm.label || '',
        color: this.connectionForm.color,
        labelColor: this.connectionForm.labelColor || '#ffffff',
        bidirectional: this.connectionForm.arrowFrom && this.connectionForm.arrowTo,
        arrowFrom: this.connectionForm.arrowFrom ?? false,
        arrowTo: this.connectionForm.arrowTo ?? false,
      };

      if (this.editingConnection) {
        await this.pinboardService.updateConnection(this.editingConnection.id, connectionData);
      } else {
        await this.pinboardService.createConnection(connectionData);
      }

      await this.refreshPinboardData();
      this.closeDialogs();
      this.networkService.unselectAll();
    } catch {
      this.notificationService.showError('Failed to save connection. Please try again.');
    }
  }

  async deleteConnection(): Promise<void> {
    if (!this.editingConnection) return;

    const confirmed = await this.modalService.confirm(
      'Are you sure you want to delete this connection?',
      'Delete Connection',
      {
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true,
      }
    );

    if (!confirmed) return;

    try {
      await this.pinboardService.deleteConnection(this.editingConnection.id);
      this.closeDialogs();
    } catch {
      this.notificationService.showError('Failed to delete connection. Please try again.');
    }
  }

  async removePinFromPinboard(nodeId: string): Promise<void> {
    const character = this.characters.find(c => c.id === nodeId);
    const characterName = character?.name || 'Character';

    const confirmed = await this.modalService.confirm(
      `Are you sure you want to remove "${characterName}" from the pinboard?`,
      'Remove Character',
      {
        confirmText: 'Remove',
        cancelText: 'Cancel',
        danger: true,
      }
    );

    if (!confirmed) return;

    try {
      await this.pinboardService.removePin(nodeId);
    } catch (error) {
      this.logger.error('Failed to remove pin:', error);
      this.notificationService.showError('Failed to remove character from pinboard. Please try again.');
    }
  }

  getCharacterById(characterId: string): Character | null {
    return this.characters.find(c => c.id === characterId) || null;
  }

  getThumbnailDataUrl(character: Character): string | null {
    return this.thumbnailDataUrls.get(character.id) || null;
  }

  getUsedConnectionColors(): string[] {
    return [
      ...new Set(
        this.pinboardService
          .getCurrentPinboardDataSnapshot()
          .edges.map(edge => edge.color)
          .filter(color => color && color.trim() !== '')
      ),
    ];
  }

  getUsedLabelColors(): string[] {
    return [
      ...new Set(
        this.pinboardService
          .getCurrentPinboardDataSnapshot()
          .edges.map(edge => edge.labelColor)
          .filter((color): color is string => !!color && color.trim() !== '')
      ),
    ];
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  onCreatePinboard(): void {
    this.showCreatePinboardDialog = true;
  }

  async onPinboardCreate(event: { name: string; duplicateFromId?: string }): Promise<void> {
    try {
      await this.projectService.createPinboard(event.name, event.duplicateFromId);
      this.showCreatePinboardDialog = false;

      const pinboards = this.projectService.getPinboards();
      const newPinboard = pinboards.find(p => p.name === event.name);
      if (newPinboard) {
        await this.pinboardService.switchPinboard(newPinboard.id);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create pinboard';
      this.notificationService.showError(message);
    }
  }

  onRenamePinboard(id: string): void {
    this.pinboardToRename = id;
    this.showRenamePinboardDialog = true;
  }

  async onPinboardRename(name: string): Promise<void> {
    if (!this.pinboardToRename) return;

    try {
      await this.projectService.updatePinboardName(this.pinboardToRename, name);
      this.showRenamePinboardDialog = false;
      this.pinboardToRename = null;
      this.loadPinboards();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to rename pinboard';
      this.notificationService.showError(message);
    }
  }

  async onDeletePinboard(id: string): Promise<void> {
    const confirmed = await this.modalService.confirm(
      'Are you sure you want to delete this pinboard? This action cannot be undone.',
      'Delete Pinboard',
      {
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true,
      }
    );

    if (!confirmed) return;

    try {
      await this.projectService.deletePinboard(id);
      this.loadPinboards();
      this.currentPinboard = this.projectService.getCurrentPinboard();
      if (this.currentPinboard) {
        await this.refreshPinboardData();
        this.networkService.restoreViewState();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to delete pinboard';
      this.notificationService.showError(message);
    }
  }

  getCurrentPinboardName(): string {
    return this.currentPinboard?.name || 'Pinboard';
  }

  getAllPinboardNames(): string[] {
    return this.pinboards.map(p => p.name);
  }

  getPinboardToRenameName(): string {
    if (!this.pinboardToRename) return '';
    const pinboard = this.pinboards.find(p => p.id === this.pinboardToRename);
    return pinboard?.name || '';
  }

  private async loadCharactersIfNeeded(): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) return;

    try {
      await this.characterService.loadCharacters(project.path);
    } catch (error) {
      this.logger.error('Failed to load characters:', error);
    }
  }

  private initializePinboard(): void {
    const container = this.pinboardContainer.nativeElement;
    this.networkService.initialize(container);
    this.interactionService.attach(container, {
      onConnectionTargetSelected: (sourceId, targetId) => {
        this.ngZone.run(() => this.openConnectionDialog(sourceId, targetId));
      },
      onDoubleClickNode: (nodeId) => {
        this.ngZone.run(() => this.openCharacterDetail(nodeId));
      },
      onDoubleClickEdge: (edgeId) => {
        this.ngZone.run(() => {
          const connection = this.findConnectionById(edgeId);
          if (connection) {
            this.openEditDialog(connection);
          }
        });
      },
      onViewChanged: () => {
        this.ngZone.run(() => this.cdr.detectChanges());
      },
    });
    this.cdr.detectChanges();
  }

  private subscribeToData(): void {
    this.subscriptions.add(
      this.characters$.subscribe(async (characters) => {
        const hadNoCharacters = this.characters.length === 0;
        this.characters = characters;
        await this.loadThumbnailDataUrls(characters);

        if (hadNoCharacters && characters.length > 0 && this.networkService.getNetwork()) {
          await this.refreshPinboardData();
        }
      })
    );

    this.subscriptions.add(
      this.pinboardData$.subscribe(async () => {
        await this.refreshPinboardData();
      })
    );
  }

  private subscribeToPinboardChanges(): void {
    const initialPinboard = this.projectService.getCurrentPinboard();
    let previousPinboardId: string | null = initialPinboard?.id || null;

    this.subscriptions.add(
      this.pinboardService.currentPinboardId$.subscribe(async (pinboardId) => {
        if (pinboardId) {
          if (previousPinboardId && previousPinboardId !== pinboardId) {
            await this.networkService.saveViewStateForPinboard(previousPinboardId);
          }

          await this.refreshPinboardData();
          this.networkService.restoreViewState();
          this.currentPinboard = this.projectService.getCurrentPinboard();
          this.loadPinboards();
          previousPinboardId = pinboardId;
        }
      })
    );

    this.subscriptions.add(
      this.projectService.currentProject$.subscribe(() => {
        this.loadPinboards();
        this.currentPinboard = this.projectService.getCurrentPinboard();
      })
    );
  }

  private loadPinboards(): void {
    this.pinboards = this.projectService.getPinboards();
    this.currentPinboard = this.projectService.getCurrentPinboard();
  }

  private async refreshPinboardData(): Promise<void> {
    const snapshot = this.pinboardService.getCurrentPinboardDataSnapshot();
    await this.networkService.updateFromPinboardData(snapshot, this.characters);
    this.cdr.detectChanges();
  }

  private findConnectionById(edgeId: string): PinboardConnection | null {
    let connection: PinboardConnection | null = null;
    this.pinboardService
      .getPinboardData()
      .pipe(take(1))
      .subscribe((data) => {
        connection = data.edges.find((edge) => edge.id === edgeId) || null;
      });
    return connection;
  }

  private async openConnectionDialog(sourceId: string, targetId: string): Promise<void> {
    let currentCharacters = this.characters;
    if (currentCharacters.length === 0) {
      this.characters$.pipe(take(1)).subscribe(characters => {
        if (characters.length > 0) {
          this.characters = characters;
          setTimeout(() => this.openConnectionDialog(sourceId, targetId), 50);
        } else {
          this.logger.error('No characters available in observable');
          this.notificationService.showWarning(
            'Characters are not loaded. Please wait a moment and try again.'
          );
        }
      });
      return;
    }

    const sourceChar = currentCharacters.find(c => c.id === sourceId);
    const targetChar = currentCharacters.find(c => c.id === targetId);

    if (!sourceChar || !targetChar) {
      this.logger.error('Invalid character selection:', { sourceId, targetId });
      this.notificationService.showError(
        'Could not find character information for the selected nodes. Please try again.'
      );
      return;
    }

    await this.loadThumbnailDataUrls([sourceChar, targetChar]);
    this.cdr.detectChanges();

    this.connectionForm = {
      source: sourceId,
      target: targetId,
      label: '',
      color: DEFAULT_CONNECTION_COLOR,
      labelColor: '#ffffff',
      arrowFrom: false,
      arrowTo: false,
    };

    this.interactionService.clearPlusIconState();
    this.editingConnection = null;
    this.showConnectionDialog = true;
    this.showEditDialog = false;
  }

  private async openEditDialog(connection: PinboardConnection): Promise<void> {
    this.editingConnection = connection;

    if (connection.arrowFrom !== undefined && connection.arrowTo !== undefined) {
      this.connectionForm = {
        source: connection.source,
        target: connection.target,
        label: connection.label || '',
        color: connection.color,
        labelColor: connection.labelColor || '#ffffff',
        arrowFrom: connection.arrowFrom,
        arrowTo: connection.arrowTo,
      };
    } else {
      this.connectionForm = {
        source: connection.source,
        target: connection.target,
        label: connection.label || '',
        color: connection.color,
        labelColor: connection.labelColor || '#ffffff',
        arrowFrom: connection.bidirectional,
        arrowTo: connection.bidirectional || true,
      };
    }

    const sourceChar = this.getCharacterById(connection.source);
    const targetChar = this.getCharacterById(connection.target);
    if (sourceChar && targetChar) {
      await this.loadThumbnailDataUrls([sourceChar, targetChar]);
      this.cdr.detectChanges();
    }

    this.showEditDialog = true;
    this.showConnectionDialog = false;
  }

  private openCharacterDetail(characterId: string): void {
    this.characterEditDialog.openEdit(characterId);
  }

  private async loadThumbnailDataUrls(characters: Character[]): Promise<void> {
    await this.characterService.loadThumbnailsForCharacters(characters);
    const cached = this.characterService.getAllCachedThumbnails();
    cached.forEach((dataUrl, id) => this.thumbnailDataUrls.set(id, dataUrl));
  }
}
