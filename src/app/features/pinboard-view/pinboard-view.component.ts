import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { DataSet, Edge, Network, Node, Options } from 'vis-network/standalone';
import { Character, PinboardData, PinboardConnection, Pinboard } from '../../core/interfaces';
import { CharacterService, ProjectService, PinboardService, ElectronService, LoggingService, NotificationService, ModalService, CharacterEditDialogService } from '../../core/services';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { ColorSelectorComponent } from '../../shared/color-selector/color-selector.component';
import { PinboardSidebarComponent } from '../../shared/pinboard-sidebar/pinboard-sidebar.component';
import { PinboardCreateDialogComponent } from '../../shared/pinboard-create-dialog/pinboard-create-dialog.component';
import { PinboardRenameDialogComponent } from '../../shared/pinboard-rename-dialog/pinboard-rename-dialog.component';

interface ConnectionFormData {
  source: string;
  target: string;
  label: string;
  color: string;
  labelColor: string; // Color for the label text
  arrowFrom: boolean; // Arrow pointing from source
  arrowTo: boolean;    // Arrow pointing to target
}

@Component({
  selector: 'app-pinboard-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    ColorSelectorComponent,
    PinboardSidebarComponent,
    PinboardCreateDialogComponent,
    PinboardRenameDialogComponent,
  ],
  templateUrl: './pinboard-view.component.html',
  styleUrls: ['./pinboard-view.component.scss'],
})
export class PinboardViewComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('pinboardContainer', { static: true }) pinboardContainer!: ElementRef;
  @ViewChild('characterFilterInput', { static: false }) characterFilterInput!: ElementRef<HTMLInputElement>;

  pinboardData$: Observable<PinboardData>;
  characters$: Observable<Character[]>;

  private subscriptions = new Subscription();
  private network: Network | null = null;
  private nodes: DataSet<Node> = new DataSet([]);
  private edges: DataSet<Edge> = new DataSet([]);

  // UI state
  showConnectionDialog = false;
  showEditDialog = false;
  showAddPinDialog = false;
  selectedNodes: string[] = [];
  characters: Character[] = [];
  
  // Connection creation state
  connectionMode = false;
  connectionSourceNode: string | null = null;
  plusIconPosition: { x: number; y: number } | null = null;
  selectedNodeForConnection: string | null = null;

  // Add node dialog state
  characterFilter = '';
  filteredCharacters: Character[] = [];
  selectedCharacterIndex = -1; // Index of highlighted character in filtered list
  thumbnailDataUrls: Map<string, string> = new Map();

  // Grid configuration
  gridSize = 100; // Fixed grid size
  showGrid = false;
  snapToGrid = true;

  // Zoom configuration
  zoomLevels = [0.5, 1.0, 1.5, 2.0, 2.5];
  currentZoomIndex = 1; // Start at 1.0x
  lastMousePosition: { x: number; y: number } | null = null;

  // Form data
  connectionForm: ConnectionFormData = {
    source: '',
    target: '',
    label: '',
    color: '#848484',
    labelColor: '#ffffff',
    arrowFrom: false,
    arrowTo: false,
  };

  editingConnection: PinboardConnection | null = null;

  // Pinboard management state
  showCreatePinboardDialog = false;
  showRenamePinboardDialog = false;
  pinboardToRename: string | null = null;
  currentPinboard: Pinboard | null = null;
  pinboards: Pinboard[] = [];

  // Node hover state for delete functionality
  hoveredNodeId: string | null = null;

  // Track if pinboard is empty
  isEmpty = false;
  networkInitialized = false;

  constructor(
    private pinboardService: PinboardService,
    private characterService: CharacterService,
    private projectService: ProjectService,
    private electronService: ElectronService,
    private router: Router,
    private route: ActivatedRoute,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
    private logger: LoggingService,
    private notificationService: NotificationService,
    private modalService: ModalService,
    private characterEditDialog: CharacterEditDialogService
  ) {
    this.pinboardData$ = this.pinboardService.getPinboardData();
    this.characters$ = this.characterService.getCharacters();
  }

  ngOnInit(): void {
    // Check if project is loaded
    const project = this.projectService.getCurrentProject();

    if (!project) {
      this.logger.error('No project loaded in pinboard view!');
      return;
    }

    // Load characters if needed
    this.loadCharactersIfNeeded();
    
    this.subscribeToData();
    this.subscribeToPinboardChanges();
    this.loadPinboards();
  }
  
  private async loadCharactersIfNeeded(): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      return;
    }

    try {
      await this.characterService.loadCharacters(project.path);
    } catch (error) {
      this.logger.error('Failed to load characters:', error);
    }
  }

  ngAfterViewInit(): void {
    // Initialize pinboard after view is ready
    setTimeout(() => {
      this.initializePinboard();
      // Force a refresh of the pinboard data after initialization
      this.refreshPinboardData();
      // Restore saved view state
      this.restoreViewState();
    }, 0);
  }

  ngOnDestroy(): void {
    // Save view state before destroying
    this.saveViewState();
    
    this.subscriptions.unsubscribe();
    if (this.network) {
      this.network.destroy();
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  handleEscapeKey(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (this.connectionMode) {
      keyboardEvent.preventDefault();
      this.exitConnectionMode();
    } else if (this.showAddPinDialog || this.showConnectionDialog || this.showEditDialog) {
      keyboardEvent.preventDefault();
      this.closeDialogs();
    }
  }

  @HostListener('document:keydown.p', ['$event'])
  handlePKey(event: KeyboardEvent): void {
    // Only trigger if not typing in an input, textarea, or if a dialog is open
    const target = event.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    
    if (!isInput && 
        !this.showAddPinDialog && 
        !this.showConnectionDialog && 
        !this.showEditDialog &&
        !this.showCreatePinboardDialog &&
        !this.showRenamePinboardDialog &&
        !this.connectionMode) {
      event.preventDefault();
      this.openAddPinDialog();
    }
  }


  private navigateCharacterList(direction: number): void {
    if (this.filteredCharacters.length === 0) {
      this.selectedCharacterIndex = -1;
      return;
    }

    this.selectedCharacterIndex += direction;

    // Clamp to valid range
    if (this.selectedCharacterIndex < 0) {
      this.selectedCharacterIndex = 0;
    } else if (this.selectedCharacterIndex >= this.filteredCharacters.length) {
      this.selectedCharacterIndex = this.filteredCharacters.length - 1;
    }

    // Scroll the selected item into view
    this.scrollToSelectedCharacter();
  }

  private selectHighlightedCharacter(): void {
    if (this.selectedCharacterIndex >= 0 && 
        this.selectedCharacterIndex < this.filteredCharacters.length) {
      const character = this.filteredCharacters[this.selectedCharacterIndex];
      this.addCharacterToPinboard(character);
    }
  }

  private scrollToSelectedCharacter(): void {
    // Use setTimeout to ensure DOM is updated
    setTimeout(() => {
      const selectedElement = document.querySelector(
        `.character-item.selected`
      ) as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }, 0);
  }

  private initializePinboard(): void {
    const container = this.pinboardContainer.nativeElement;

    const options: Options = {
      nodes: {
        shape: 'dot',
        size: 20,
        font: {
          size: 14,
          color: '#ffffff',
          face: 'Arial, sans-serif',
          align: 'center',
          multi: false,
          strokeWidth: 2,
          strokeColor: '#0a0e1a',
          bold: '500',
        },
        borderWidth: 2,
        shadow: true,
        labelHighlightBold: false,
      },
      edges: {
        width: 2,
        color: { inherit: 'from' },
        smooth: {
          enabled: true,
          type: 'continuous',
          roundness: 0.5,
        },
        arrows: {
          to: { enabled: true, scaleFactor: 1 },
        },
        font: {
          size: 12,
          color: '#e5e7eb',
          strokeWidth: 1,
          strokeColor: '#0a0e1a',
        },
      },
      physics: {
        enabled: false, // Completely disable physics
        stabilization: false, // Disable stabilization
      },
      layout: {
        randomSeed: 42, // Fixed seed to prevent random positioning
        improvedLayout: false, // Disable improved layout algorithm
        hierarchical: false,
      },
      interaction: {
        dragNodes: true,
        dragView: false, // Disable default panning - we'll use middle-click
        zoomView: false, // Disable default zoom to use our discrete zoom
        selectConnectedEdges: false,
        multiselect: true, // Enable multi-select with left-click drag
        selectable: true,
        hover: true, // Enable hover events for plus icon
      },
      manipulation: {
        enabled: false,
      },
    };

    this.network = new Network(container, { nodes: this.nodes, edges: this.edges }, options);
    this.networkInitialized = true;

    this.logger.log('Network initialized, setting up events...');
    this.setupNetworkEvents();
    this.setupDiscreteZoom();
    this.setupMiddleClickPan();
    
    // Check initial empty state
    this.isEmpty = this.nodes.length === 0;
    this.cdr.detectChanges();
  }

  private setupDiscreteZoom(): void {
    if (!this.network) return;

    // Override the default zoom behavior
    const canvas = this.pinboardContainer.nativeElement.querySelector('canvas');
    if (canvas) {
      // Track mouse position
      canvas.addEventListener('mousemove', (event: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        this.lastMousePosition = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
      });

      canvas.addEventListener(
        'wheel',
        (event: WheelEvent) => {
          event.preventDefault();

          // Get mouse position for zoom center
          const rect = canvas.getBoundingClientRect();
          const mousePos = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          };

          if (event.deltaY < 0) {
            // Zoom in
            this.zoomIn(mousePos);
          } else {
            // Zoom out
            this.zoomOut(mousePos);
          }
        },
        { passive: false }
      );
    }
  }

  private setupMiddleClickPan(): void {
    if (!this.network) return;

    const canvas = this.pinboardContainer.nativeElement.querySelector('canvas');
    if (!canvas) return;

    let isPanning = false;
    let startPos = { x: 0, y: 0 };
    let startViewPos = { x: 0, y: 0 };

    canvas.addEventListener('mousedown', (event: MouseEvent) => {
      // Middle mouse button (button === 1)
      if (event.button === 1) {
        event.preventDefault();
        isPanning = true;
        startPos = { x: event.clientX, y: event.clientY };
        if (this.network) {
          startViewPos = this.network.getViewPosition();
        }
        canvas.style.cursor = 'grabbing';
      }
    });

    canvas.addEventListener('mousemove', (event: MouseEvent) => {
      if (isPanning && this.network) {
        event.preventDefault();

        const dx = event.clientX - startPos.x;
        const dy = event.clientY - startPos.y;

        const scale = this.network.getScale();

        // Move view in opposite direction of mouse movement
        const newViewPos = {
          x: startViewPos.x - dx / scale,
          y: startViewPos.y - dy / scale,
        };

        this.network.moveTo({
          position: newViewPos,
          scale: scale,
          animation: false,
        });
      }
    });

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 1 && isPanning) {
        isPanning = false;
        canvas.style.cursor = 'default';

        // Save view state after panning
        setTimeout(() => {
          this.saveViewState();
          this.constrainView();
        }, 100);
      }
    };

    canvas.addEventListener('mouseup', handleMouseUp);
    // Handle case where mouse is released outside canvas
    document.addEventListener('mouseup', handleMouseUp);

    // Prevent context menu on middle click (but allow right-click for node context menu)
    canvas.addEventListener('contextmenu', (event: MouseEvent) => {
      // Only prevent default for middle click
      if (event.button === 1) {
        event.preventDefault();
      }
    });
  }

  private setupNetworkEvents(): void {
    if (!this.network) return;

    // Handle node selection for connection creation
    this.network.on('selectNode', (params) => {
      this.selectedNodes = params.nodes;
      
      // If in connection mode and a node is selected, create connection
      if (this.connectionMode && this.connectionSourceNode && params.nodes.length > 0) {
        const targetNode = params.nodes[0];
        if (targetNode !== this.connectionSourceNode) {
          // Use setTimeout to ensure the selection event completes first
          setTimeout(() => {
            this.openConnectionDialog(this.connectionSourceNode!, targetNode);
            this.exitConnectionMode();
          }, 0);
        } else {
          // Same node clicked, just exit connection mode
          this.exitConnectionMode();
        }
        return;
      }
      // Note: Character detail view is opened via double-click, not single click
      // This allows the plus icon for connections to work on hover/click
    });
    
    // Handle hover to show plus icon and delete button
    this.network.on('hoverNode', (params) => {
      if (!this.connectionMode && params.node) {
        this.selectedNodeForConnection = params.node;
        this.hoveredNodeId = params.node;
        setTimeout(() => {
          this.updatePlusIconPosition(params.node);
          // Trigger change detection to update delete icon position
          this.cdr.detectChanges();
        }, 10);
      }
    });

    // Handle blur to hide plus icon and delete button
    this.network.on('blurNode', () => {
      if (!this.connectionMode) {
        this.selectedNodeForConnection = null;
        this.hoveredNodeId = null;
        this.plusIconPosition = null;
      }
    });
    
    // Handle clicking on canvas to exit connection mode
    this.network.on('click', (params) => {
      if (this.connectionMode) {
        if (params.nodes.length === 0 && params.edges.length === 0) {
          // Clicked on empty canvas, exit connection mode
          this.exitConnectionMode();
        } else if (params.nodes.length > 0) {
          // Node was clicked - this will be handled by selectNode event
          // But we need to make sure the click doesn't interfere
          const clickedNode = params.nodes[0];
          if (clickedNode !== this.connectionSourceNode) {
            // Target node clicked - connection will be created via selectNode handler
            // Don't exit here, let selectNode handle it
          }
        }
      }
      // Note: Node selection and navigation is handled in selectNode event
    });


    // Handle edge selection for editing (removed - now only on double-click)
    // Edge selection is now handled via doubleClick event

    // Handle double-click for character detail, connection editing, or creation
    this.network.on('doubleClick', (params) => {
      if (params.nodes.length > 0 && params.edges.length === 0) {
        // Double-click on a node - open character detail view
        const clickedNodeId = params.nodes[0];
        this.openCharacterDetail(clickedNodeId);
      } else if (params.edges.length > 0) {
        // Double-click on edge/connection - open edit dialog
        const edgeId = params.edges[0];
        const connection = this.findConnectionById(edgeId);
        if (connection) {
          this.openEditDialog(connection);
        }
      }
    });


    // Disable physics when starting to drag
    this.network.on('dragStart', (params) => {
      if (params.nodes.length > 0) {
        this.network!.setOptions({ physics: { enabled: false } });
      }
    });

    // Handle dragging with grid snapping and collision detection
    this.network.on('dragging', (params) => {
      if (params.nodes.length > 0) {
        const positions = this.network!.getPositions(params.nodes);
        const draggedNodeId = params.nodes[0];
        let targetPos = positions[draggedNodeId];
        
        // Update plus icon position in real-time if dragging the selected node
        if (this.selectedNodeForConnection === draggedNodeId) {
          this.updatePlusIconPosition(draggedNodeId);
        }
        
        // Trigger change detection to update delete icon position if dragging hovered node
        if (this.hoveredNodeId === draggedNodeId) {
          this.cdr.detectChanges();
        }

        // Apply grid snapping if enabled
        if (this.snapToGrid) {
          targetPos = {
            x: Math.round(targetPos.x / this.gridSize) * this.gridSize,
            y: Math.round(targetPos.y / this.gridSize) * this.gridSize,
          };
        }

        // Check for collisions with other nodes
        const allPositions = this.network!.getPositions();
        let finalPos = targetPos;

        for (const [nodeId, nodePos] of Object.entries(allPositions)) {
          if (nodeId !== draggedNodeId) {
            // Check if positions are the same
            if (Math.abs(nodePos.x - targetPos.x) < 1 && Math.abs(nodePos.y - targetPos.y) < 1) {
              // Position is occupied, don't allow the move
              return;
            }
          }
        }

        this.network!.moveNode(draggedNodeId, finalPos.x, finalPos.y);
      }
    });

    // Save node positions when dragging stops
    this.network.on('dragEnd', (params) => {
      if (params.nodes.length > 0) {
        const positions = this.network!.getPositions(params.nodes);
        const allPositions = this.network!.getPositions();
        
        // Update plus icon position if the selected node was dragged
        if (this.selectedNodeForConnection && params.nodes.includes(this.selectedNodeForConnection)) {
          setTimeout(() => {
            this.updatePlusIconPosition(this.selectedNodeForConnection!);
          }, 50);
        }

        // Apply grid snapping and collision detection if enabled
        if (this.snapToGrid) {
          const snappedPositions: { [key: string]: { x: number; y: number } } = {};

          Object.keys(positions).forEach((nodeId) => {
            const pos = positions[nodeId];
            let snappedPos = {
              x: Math.round(pos.x / this.gridSize) * this.gridSize,
              y: Math.round(pos.y / this.gridSize) * this.gridSize,
            };

            // Check if snapped position is occupied by another node
            for (const [otherId, otherPos] of Object.entries(allPositions)) {
              if (otherId !== nodeId) {
                if (Math.abs(otherPos.x - snappedPos.x) < 1 && Math.abs(otherPos.y - snappedPos.y) < 1) {
                  // Position is occupied, keep original position
                  snappedPos = pos;
                  break;
                }
              }
            }

            snappedPositions[nodeId] = snappedPos;
          });

          // Update positions in the network
          Object.keys(snappedPositions).forEach((nodeId) => {
            this.network!.moveNode(nodeId, snappedPositions[nodeId].x, snappedPositions[nodeId].y);
          });

          // Save snapped positions
          Object.keys(snappedPositions).forEach((nodeId) => {
            this.pinboardService.updatePinPosition(nodeId, snappedPositions[nodeId]);
          });
        } else {
          // Save original positions (no snapping, but still check collisions)
          Object.keys(positions).forEach((nodeId) => {
            let finalPos = positions[nodeId];

            // Check for collisions
            for (const [otherId, otherPos] of Object.entries(allPositions)) {
              if (otherId !== nodeId) {
                if (Math.abs(otherPos.x - finalPos.x) < 1 && Math.abs(otherPos.y - finalPos.y) < 1) {
                  // Position is occupied, don't save (pin will snap back)
                  return;
                }
              }
            }

            this.pinboardService.updatePinPosition(nodeId, finalPos);
          });
        }
      }
    });

    // Handle zoom and pan events to redraw grid and update plus icon position
    this.network.on('zoom', () => {
      this.redrawGrid();
      this.constrainView();
      if (this.selectedNodeForConnection) {
        this.updatePlusIconPosition(this.selectedNodeForConnection);
      }
      // Trigger change detection to update delete icon position
      if (this.hoveredNodeId) {
        this.cdr.detectChanges();
      }
    });
    
    // Update plus icon position when view changes
    this.network.on('dragEnd', () => {
      if (this.selectedNodeForConnection) {
        setTimeout(() => {
          this.updatePlusIconPosition(this.selectedNodeForConnection!);
        }, 50);
      }
      // Trigger change detection to update delete icon position
      if (this.hoveredNodeId) {
        this.cdr.detectChanges();
      }
    });

    // Listen to view position changes (panning)
    let dragTimeout: any = null;
    this.network.on('dragging', () => {
      // Clear previous timeout
      if (dragTimeout) clearTimeout(dragTimeout);

      // Set new timeout to check constraint after dragging settles
      dragTimeout = setTimeout(() => {
        this.constrainView();
      }, 100);
    });

    this.network.on('dragEnd', () => {
      // Constrain view to keep at least one node visible
      setTimeout(() => this.constrainView(), 50);

      // Save view state after panning
      setTimeout(() => this.saveViewState(), 100);

      // Redraw grid after view changes (but delay to avoid conflicts with node dragging)
      setTimeout(() => {
        this.redrawGrid();
      }, 50);
    });

    // Handle stabilization complete
    this.network.on('stabilizationIterationsDone', () => {
      this.network!.setOptions({ physics: { enabled: false } });
    });

    // Set up custom rendering for grid
    this.network.on('beforeDrawing', (ctx) => {
      if (this.showGrid) {
        this.drawGridOnCanvas(ctx);
      }
    });
  }

  private subscribeToData(): void {
    // Subscribe to character changes (but don't automatically add nodes)
    this.subscriptions.add(
      this.characters$.subscribe(async (characters) => {
        const hadNoCharacters = this.characters.length === 0;
        this.characters = characters;
        // Load thumbnails for character selection dialog
        await this.loadThumbnailDataUrls(characters);
        
        // If characters just loaded (were 0, now have some) and network exists,
        // refresh the pinboard to show images
        if (hadNoCharacters && characters.length > 0 && this.network) {
          await this.refreshPinboardData();
        }
      })
    );

    // Subscribe to pinboard data changes
    this.subscriptions.add(
      this.pinboardData$.subscribe(async (pinboardData) => {
        await this.updatePinboard(pinboardData);
      })
    );
  }

  private subscribeToPinboardChanges(): void {
    // Get initial pinboard ID from current pinboard
    const initialPinboard = this.projectService.getCurrentPinboard();
    let previousPinboardId: string | null = initialPinboard?.id || null;
    
    // Subscribe to current pinboard ID changes to reload data when switching
    this.subscriptions.add(
      this.pinboardService.currentPinboardId$.subscribe(async (pinboardId) => {
        if (pinboardId) {
          // Save view state for the previous pinboard before switching
          if (previousPinboardId && previousPinboardId !== pinboardId) {
            await this.saveViewStateForPinboard(previousPinboardId);
          }
          
          // Load new pinboard data
          await this.refreshPinboardData();
          
          // Restore view state for new pinboard
          this.restoreViewState();
          
          // Update current pinboard reference
          this.currentPinboard = this.projectService.getCurrentPinboard();
          this.loadPinboards();
          
          // Update previous pinboard ID
          previousPinboardId = pinboardId;
        }
      })
    );

    // Subscribe to project changes to update pinboard list
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

  private async updatePinboard(pinboardData: PinboardData): Promise<void> {
    if (!this.network) {
      console.warn('updatePinboard called but network is not initialized');
      return;
    }

    // Ensure character images are loaded before updating
    if (this.characters.length > 0) {
      await this.loadThumbnailDataUrls(this.characters);
    }

    // Convert to vis.js format with thumbnails loaded dynamically
    const visData = await this.pinboardService.getVisJsDataWithThumbnails(this.characters);

    // Preload images to ensure they're ready before updating the network
    const imagePromises = visData.nodes
      .filter(node => node.image)
      .map(node => {
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve(); // Resolve even on error to not block
          img.src = node.image;
        });
      });
    
    await Promise.all(imagePromises);

    // Update nodes
    this.nodes.clear();
    this.nodes.add(visData.nodes);
    
    // Update empty state
    this.isEmpty = visData.nodes.length === 0;
    this.cdr.detectChanges();

    // Update edges - remove and re-add to ensure arrows are properly updated
    // vis-network sometimes doesn't update arrows properly with just update()
    const edgeIds = new Set(visData.edges.map(e => e.id));
    const existingEdgeIds = new Set(this.edges.getIds() as string[]);
    
    // Remove edges that no longer exist
    existingEdgeIds.forEach(id => {
      if (!edgeIds.has(id)) {
        this.edges.remove(id);
      }
    });
    
    // For existing edges, remove and re-add to force arrow update
    visData.edges.forEach(edge => {
      if (existingEdgeIds.has(edge.id)) {
        this.edges.remove(edge.id);
      }
      this.edges.add(edge);
    });

    // Force redraw to ensure positions, arrows, and images are applied
    this.network.redraw();
    this.cdr.detectChanges();

    // Explicitly enforce pin positions immediately and again after a short delay
    this.enforcePinPositions(pinboardData);
    
    // Force additional redraws after a short delay to ensure images appear
    setTimeout(() => {
      this.enforcePinPositions(pinboardData);
      if (this.network) {
        this.network.redraw();
      }
    }, 50);
    
    // One more redraw after images have had time to render
    setTimeout(() => {
      if (this.network) {
        this.network.redraw();
        this.cdr.detectChanges();
      }
    }, 200);
  }

  /**
   * Explicitly enforces pin positions from stored data
   */
  private enforcePinPositions(pinboardData: PinboardData): void {
    if (!this.network) return;

    for (const node of pinboardData.nodes) {
      // Check if node exists in the DataSet before trying to move it
      const existingNode = this.nodes.get(node.id);
      if (existingNode) {
        try {
          // Update the node in the DataSet to ensure position is set
          this.nodes.update({
            id: node.id,
            x: node.position.x,
            y: node.position.y,
          });
          // Also use moveNode for immediate visual update
          this.network.moveNode(node.id, node.position.x, node.position.y);
        } catch (error) {
          console.warn(`Failed to move node ${node.id}:`, error);
        }
      }
    }

    // Disable physics to prevent any automatic repositioning
    this.network.setOptions({ physics: { enabled: false } });
  }

  private findConnectionById(edgeId: string): PinboardConnection | null {
    const currentData = this.pinboardService.getPinboardData();
    // We need to get the current value synchronously
    let connection: PinboardConnection | null = null;
    this.subscriptions.add(
      currentData
        .subscribe((data) => {
          connection = data.edges.find((edge) => edge.id === edgeId) || null;
        })
        .unsubscribe()
    );
    return connection;
  }

  // UI Event Handlers
  onCreateConnection(): void {
    if (this.selectedNodes.length === 2) {
      this.openConnectionDialog(this.selectedNodes[0], this.selectedNodes[1]);
    } else {
      this.notificationService.showWarning('Please select exactly two characters to create a connection.');
    }
  }
  
  /**
   * Updates the position of the plus icon based on selected node
   */
  private updatePlusIconPosition(nodeId: string): void {
    if (!this.network) {
      return;
    }
    
    const positions = this.network.getPositions([nodeId]);
    const nodePosition = positions[nodeId];
    
    if (!nodePosition) {
      return;
    }
    
    // Get the canvas element
    const canvas = this.pinboardContainer.nativeElement.querySelector('canvas');
    if (!canvas) {
      return;
    }
    
    // Get the container (pinboard-container) for positioning
    const container = this.pinboardContainer.nativeElement.closest('.pinboard-container');
    if (!container) {
      return;
    }
    
    // Use vis-network's canvasToDOM to convert network coordinates to DOM coordinates
    // This gives us the pixel position on the canvas
    const canvasPos = this.network.canvasToDOM(nodePosition);
    
    // Get the canvas position relative to the container
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = (container as HTMLElement).getBoundingClientRect();
    
    // Calculate the offset from canvas to container
    const canvasOffsetX = canvasRect.left - containerRect.left;
    const canvasOffsetY = canvasRect.top - containerRect.top;
    
    // Get node size (approximate, including thumbnail)
    const nodeSize = 30;
    const plusIconSize = 32; // Size of the plus icon
    const plusIconOffset = nodeSize / 2 + plusIconSize / 2 + 10; // Distance from node center
    
    // Position the plus icon to the right of the node
    this.plusIconPosition = {
      x: canvasPos.x + plusIconOffset + canvasOffsetX,
      y: canvasPos.y + canvasOffsetY
    };
    
    // Force change detection to update the view
    this.cdr.detectChanges();
  }
  
  /**
   * Handles clicking the plus icon to start connection creation
   */
  onPlusIconClick(event: MouseEvent): void {
    event.stopPropagation();
    
    if (this.selectedNodeForConnection) {
      this.connectionMode = true;
      this.connectionSourceNode = this.selectedNodeForConnection;
      
      // Change cursor to indicate connection mode
      if (this.network) {
        const canvas = this.pinboardContainer.nativeElement.querySelector('canvas');
        if (canvas) {
          canvas.style.cursor = 'crosshair';
        }
      }
    }
  }
  
  /**
   * Exits connection creation mode
   */
  exitConnectionMode(): void {
    this.connectionMode = false;
    this.connectionSourceNode = null;
    
    // Reset cursor
    if (this.network) {
      const canvas = this.pinboardContainer.nativeElement.querySelector('canvas');
      if (canvas) {
        canvas.style.cursor = 'default';
      }
    }
  }

  onLayoutNodes(): void {
    if (this.network) {
      this.network.setOptions({ physics: { enabled: true } });
      this.network.stabilize();
    }
  }

  onResetView(): void {
    if (this.network) {
      this.network.fit();
    }
  }

  onTogglePhysics(): void {
    if (this.network) {
      const currentPhysics = this.network.getOptionsFromConfigurator().physics?.enabled;
      this.network.setOptions({ physics: { enabled: !currentPhysics } });
    }
  }

  zoomIn(mousePos?: { x: number; y: number }): void {
    if (this.network && this.currentZoomIndex < this.zoomLevels.length - 1) {
      this.currentZoomIndex++;
      const scale = this.zoomLevels[this.currentZoomIndex];

      if (mousePos) {
        // Zoom towards mouse position
        const pointer = this.network.DOMtoCanvas(mousePos);
        this.network.moveTo({
          position: pointer,
          scale,
          animation: {
            duration: 200,
            easingFunction: 'easeInOutQuad',
          },
        });
      } else {
        // Zoom to center
        this.network.moveTo({
          scale,
          animation: {
            duration: 200,
            easingFunction: 'easeInOutQuad',
          },
        });
      }

      // Constrain view after zoom completes
      setTimeout(() => {
        this.constrainView();
        this.saveViewState();
      }, 250);
    }
  }

  zoomOut(mousePos?: { x: number; y: number }): void {
    if (this.network && this.currentZoomIndex > 0) {
      this.currentZoomIndex--;
      const scale = this.zoomLevels[this.currentZoomIndex];

      if (mousePos) {
        // Zoom towards mouse position
        const pointer = this.network.DOMtoCanvas(mousePos);
        this.network.moveTo({
          position: pointer,
          scale,
          animation: {
            duration: 200,
            easingFunction: 'easeInOutQuad',
          },
        });
      } else {
        // Zoom to center
        this.network.moveTo({
          scale,
          animation: {
            duration: 200,
            easingFunction: 'easeInOutQuad',
          },
        });
      }

      // Constrain view after zoom completes
      setTimeout(() => {
        this.constrainView();
        this.saveViewState();
      }, 250);
    }
  }

  getCurrentZoomLevel(): string {
    return `${(this.zoomLevels[this.currentZoomIndex] * 100).toFixed(0)}%`;
  }

  onToggleGrid(): void {
    this.showGrid = !this.showGrid;
    this.redrawGrid();
    this.saveViewState();
  }

  onToggleSnapToGrid(): void {
    this.snapToGrid = !this.snapToGrid;
    this.saveViewState();
  }

  onRefreshPinboard(): void {
    this.refreshPinboardData();
  }

  onDebugPositions(): void {
    if (!this.network) return;

    // Get current vis.js positions
    const visPositions = this.network.getPositions();

    // Get stored positions from service
    this.pinboardService.debugLogPinboardState();

    // Compare them
    const currentData = this.pinboardService.getPinboardData();
    let storedData: any = null;
    const sub = currentData.subscribe((data) => (storedData = data));
    sub.unsubscribe();
  }

  private redrawGrid(): void {
    if (this.network) {
      this.network.redraw();
    }
  }

  private drawGridOnCanvas(ctx: CanvasRenderingContext2D): void {
    if (!this.network) return;

    // Get the current view position and scale from vis.js
    const scale = this.network.getScale();
    const viewPosition = this.network.getViewPosition();

    // Get canvas dimensions in CSS pixels
    const canvas = this.pinboardContainer.nativeElement.querySelector('canvas');
    if (!canvas) return;
    
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;

    // Grid size in screen pixels at current zoom
    const gridScreenSize = this.gridSize * scale;
    
    // Ensure grid size is at least 10 pixels to avoid too many lines
    if (gridScreenSize < 10) {
      return;
    }

    // Calculate the visible area in network coordinates
    const halfWidth = canvasWidth / (2 * scale);
    const halfHeight = canvasHeight / (2 * scale);
    
    const left = viewPosition.x - halfWidth;
    const right = viewPosition.x + halfWidth;
    const top = viewPosition.y - halfHeight;
    const bottom = viewPosition.y + halfHeight;

    // Find the first grid line in each direction (in network coordinates)
    const startX = Math.floor(left / this.gridSize) * this.gridSize;
    const endX = Math.ceil(right / this.gridSize) * this.gridSize;
    const startY = Math.floor(top / this.gridSize) * this.gridSize;
    const endY = Math.ceil(bottom / this.gridSize) * this.gridSize;

    // Set grid line style - dark theme
    ctx.strokeStyle = 'rgba(45, 55, 72, 0.5)';
    ctx.lineWidth = 1 / scale; // Adjust line width for zoom
    ctx.setLineDash([]);

    ctx.beginPath();

    // Draw vertical lines (in network coordinates - vis-network's transform handles conversion)
    for (let x = startX; x <= endX; x += this.gridSize) {
      ctx.moveTo(x, startY - this.gridSize);
      ctx.lineTo(x, endY + this.gridSize);
    }

    // Draw horizontal lines (in network coordinates)
    for (let y = startY; y <= endY; y += this.gridSize) {
      ctx.moveTo(startX - this.gridSize, y);
      ctx.lineTo(endX + this.gridSize, y);
    }

    ctx.stroke();
  }

  /**
   * Constrains the view to ensure at least one node is fully visible
   */
  private constrainView(): void {
    if (!this.network) return;

    const positions = this.network.getPositions();
    const nodeIds = Object.keys(positions);

    if (nodeIds.length === 0) return;

    // Get viewport boundaries
    const canvas = this.pinboardContainer.nativeElement.querySelector('canvas');
    if (!canvas) return;

    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    const scale = this.network.getScale();

    // Node size in screen pixels (including some padding for the label)
    const nodeSize = 20 * scale; // Scale with zoom
    const labelPadding = 80; // Extra padding for labels
    const margin = nodeSize + labelPadding;

    // Check if at least one node is fully visible (with label)
    let hasVisibleNode = false;
    for (const nodeId of nodeIds) {
      const canvasPos = this.network.canvasToDOM(positions[nodeId]);

      // Check if this node center is visible within the viewport bounds (with margin)
      if (
        canvasPos.x >= margin &&
        canvasPos.x <= canvasWidth - margin &&
        canvasPos.y >= margin &&
        canvasPos.y <= canvasHeight - margin
      ) {
        hasVisibleNode = true;
        break;
      }
    }

    // If no node is fully visible, find the closest node and move view to show it
    if (!hasVisibleNode) {
      const viewPosition = this.network.getViewPosition();
      let closestNode: string | null = null;
      let minDistance = Infinity;

      // Find the node closest to the current view center
      for (const nodeId of nodeIds) {
        const pos = positions[nodeId];
        const dx = pos.x - viewPosition.x;
        const dy = pos.y - viewPosition.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < minDistance) {
          minDistance = distance;
          closestNode = nodeId;
        }
      }

      // Move view to show the closest node (centered)
      if (closestNode) {
        this.network.moveTo({
          position: positions[closestNode],
          scale,
          animation: {
            duration: 200,
            easingFunction: 'easeInOutQuad',
          },
        });
      }
    }
  }

  // Connection Dialog Methods
  async openConnectionDialog(sourceId: string, targetId: string): Promise<void> {
    // Get current characters synchronously from observable
    let currentCharacters = this.characters;
    if (currentCharacters.length === 0) {
      // Try to get the current value from the observable
      this.characters$.pipe(take(1)).subscribe(characters => {
        if (characters.length > 0) {
          this.characters = characters;
          // Retry with loaded characters
          setTimeout(() => {
            this.openConnectionDialog(sourceId, targetId);
          }, 50);
        } else {
          this.logger.error('No characters available in observable');
          this.notificationService.showWarning('Characters are not loaded. Please wait a moment and try again.');
        }
      });
      return;
    }
    
    const sourceChar = currentCharacters.find((c) => c.id === sourceId);
    const targetChar = currentCharacters.find((c) => c.id === targetId);

    if (!sourceChar || !targetChar) {
      this.logger.error('Invalid character selection:', {
        sourceId,
        targetId,
        charactersCount: currentCharacters.length,
        characterIds: currentCharacters.map(c => c.id),
        sourceFound: !!sourceChar,
        targetFound: !!targetChar,
        sourceCharName: sourceChar?.name,
        targetCharName: targetChar?.name,
        matchingSource: currentCharacters.filter(c => c.id.includes(sourceId) || sourceId.includes(c.id)),
        matchingTarget: currentCharacters.filter(c => c.id.includes(targetId) || targetId.includes(c.id))
      });
      this.notificationService.showError(`Could not find character information for the selected nodes. Please try again.`);
      return;
    }

    // Ensure images are loaded for preview
    await this.loadThumbnailDataUrls([sourceChar, targetChar]);
    this.cdr.detectChanges();

    this.connectionForm = {
      source: sourceId,
      target: targetId,
      label: '',
      color: '#848484',
      labelColor: '#ffffff',
      arrowFrom: false,
      arrowTo: false,
    };

    // Clear plus icon state before showing dialog
    this.selectedNodeForConnection = null;
    this.plusIconPosition = null;
    
    this.showConnectionDialog = true;
  }

  async openEditDialog(connection: PinboardConnection): Promise<void> {
    this.editingConnection = connection;
    // Convert connection to form data
    // Use arrowFrom/arrowTo if available, otherwise derive from bidirectional
    // For old connections: bidirectional=true means both arrows, bidirectional=false means arrowTo only
    if (connection.arrowFrom !== undefined && connection.arrowTo !== undefined) {
      // New format: use the stored values (both are explicitly set)
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
      // Legacy format: convert from bidirectional
      this.connectionForm = {
        source: connection.source,
        target: connection.target,
        label: connection.label || '',
        color: connection.color,
        labelColor: connection.labelColor || '#ffffff',
        arrowFrom: connection.bidirectional,
        arrowTo: connection.bidirectional || true, // Old connections defaulted to arrowTo
      };
    }

    // Ensure images are loaded for preview
    const sourceChar = this.getCharacterById(connection.source);
    const targetChar = this.getCharacterById(connection.target);
    if (sourceChar && targetChar) {
      await this.loadThumbnailDataUrls([sourceChar, targetChar]);
      this.cdr.detectChanges();
    }

    this.showEditDialog = true;
  }

  async saveConnection(): Promise<void> {
    try {
      // Convert form data to PinboardConnection format
      // Always explicitly set both arrowFrom and arrowTo (even if false) to use new format
      const connectionData: Omit<PinboardConnection, 'id'> = {
        source: this.connectionForm.source,
        target: this.connectionForm.target,
        type: '', // Empty type for backward compatibility
        label: this.connectionForm.label || '',
        color: this.connectionForm.color,
        labelColor: this.connectionForm.labelColor || '#ffffff',
        bidirectional: this.connectionForm.arrowFrom && this.connectionForm.arrowTo, // Legacy support
        arrowFrom: this.connectionForm.arrowFrom ?? false,
        arrowTo: this.connectionForm.arrowTo ?? false,
      };

      if (this.editingConnection) {
        // Update existing connection
        await this.pinboardService.updateConnection(this.editingConnection.id, connectionData);
      } else {
        // Create new connection
        await this.pinboardService.createConnection(connectionData);
      }

      // Force refresh of pinboard data to ensure arrows are updated
      await this.refreshPinboardData();

      this.closeDialogs();
      
      // Clear selection after creating connection
      if (this.network) {
        this.network.unselectAll();
      }
    } catch (error) {
      this.notificationService.showError('Failed to save connection. Please try again.');
    }
  }

  async deleteConnection(): Promise<void> {
    if (!this.editingConnection) return;

    if (confirm('Are you sure you want to delete this connection?')) {
      try {
        await this.pinboardService.deleteConnection(this.editingConnection.id);
        this.closeDialogs();
      } catch (error) {
        this.notificationService.showError('Failed to delete connection. Please try again.');
      }
    }
  }

  closeDialogs(): void {
    this.showConnectionDialog = false;
    this.showEditDialog = false;
    this.showAddPinDialog = false;
    this.editingConnection = null;
    this.characterFilter = '';
    this.filteredCharacters = [];
    this.selectedCharacterIndex = -1;
    this.connectionForm = {
      source: '',
      target: '',
      label: '',
      color: '#848484',
      labelColor: '#ffffff',
      arrowFrom: false,
      arrowTo: false,
    };
    this.exitConnectionMode();
  }

  // Add Pin Dialog Methods
  openAddPinDialog(): void {
    this.characterFilter = '';
    this.selectedCharacterIndex = -1;
    this.updateFilteredCharacters();
    this.showAddPinDialog = true;
    
    // Focus the search input after the dialog is rendered
    setTimeout(() => {
      if (this.characterFilterInput) {
        this.characterFilterInput.nativeElement.focus();
      }
    }, 0);
  }

  updateFilteredCharacters(): void {
    const currentPinboardData = this.pinboardService.getPinboardData();
    let pinboardPins: string[] = [];

    // Get current pins synchronously
    const sub = currentPinboardData.subscribe(data => {
      pinboardPins = data.nodes.map(node => node.id);
    });
    sub.unsubscribe();

    // Filter out characters that are already on the pinboard
    let availableCharacters = this.characters.filter(char => !pinboardPins.includes(char.id));

    // Apply search filter if present
    if (this.characterFilter.trim()) {
      const filter = this.characterFilter.toLowerCase();
      availableCharacters = availableCharacters.filter(char =>
        char.name.toLowerCase().includes(filter) ||
        char.category.toLowerCase().includes(filter)
      );
    }

    this.filteredCharacters = availableCharacters;
    
    // Reset selection if current selection is out of bounds
    if (this.selectedCharacterIndex >= this.filteredCharacters.length) {
      this.selectedCharacterIndex = this.filteredCharacters.length > 0 
        ? this.filteredCharacters.length - 1 
        : -1;
    }
  }

  async addCharacterToPinboard(character: Character): Promise<void> {
    try {
      await this.pinboardService.addPin(character, this.gridSize);
      this.closeDialogs();
    } catch (error) {
      this.logger.error('Failed to add character to pinboard:', error);
      this.notificationService.showError(`Failed to add character to pinboard: ${error}`);
    }
  }

  getCategoryColor(category: string): string {
    const project = this.projectService.getCurrentProject();
    if (project) {
      const categoryData = project.metadata.categories.find(cat => cat.id === category);
      if (categoryData) {
        return categoryData.color;
      }
    }
    return '#95a5a6';
  }

  getCategoryName(categoryId: string): string {
    const project = this.projectService.getCurrentProject();
    if (project) {
      const category = project.metadata.categories.find(cat => cat.id === categoryId);
      return category?.name || categoryId;
    }
    return categoryId;
  }

  getCategoryTooltip(categoryId: string): string {
    const project = this.projectService.getCurrentProject();
    if (project) {
      const category = project.metadata.categories.find(cat => cat.id === categoryId);
      if (category) {
        if (category.description) {
          return category.description;
        }
        return category.name;
      }
    }
    return categoryId;
  }

  getThumbnailDataUrl(character: Character): string | null {
    return this.thumbnailDataUrls.get(character.id) || null;
  }

  /**
   * Gets all unique connection colors used in existing connections
   */
  getUsedConnectionColors(): string[] {
    // Get current pinboard data from the observable
    let colors: string[] = [];
    const subscription = this.pinboardData$.pipe(take(1)).subscribe((data) => {
      colors = [...new Set(
        data.edges
          .map(edge => edge.color)
          .filter(color => color && color.trim() !== '')
      )];
    });
    subscription.unsubscribe();
    
    return colors;
  }

  /**
   * Gets all unique label colors used in existing connections
   */
  getUsedLabelColors(): string[] {
    // Get current pinboard data from the observable
    let colors: string[] = [];
    const subscription = this.pinboardData$.pipe(take(1)).subscribe((data) => {
      colors = [...new Set(
        data.edges
          .map(edge => edge.labelColor)
          .filter((color): color is string => !!color && color.trim() !== '')
      )];
    });
    subscription.unsubscribe();
    
    return colors;
  }

  private async loadThumbnailDataUrls(characters: Character[]): Promise<void> {
    await this.characterService.loadThumbnailsForCharacters(characters);
    const cached = this.characterService.getAllCachedThumbnails();
    cached.forEach((dataUrl, id) => this.thumbnailDataUrls.set(id, dataUrl));
  }

  // Helper methods
  getCharacterById(characterId: string): Character | null {
    return this.characters.find(c => c.id === characterId) || null;
  }

  getCharacterName(characterId: string): string {
    const character = this.characters.find((c) => c.id === characterId);
    return character ? character.name : 'Unknown';
  }

  /**
   * Opens the character detail view for the given character ID.
   * Wrapped in NgZone because vis.js double-click runs outside Angular's zone.
   */
  openCharacterDetail(characterId: string): void {
    this.ngZone.run(() => {
      this.characterEditDialog.openEdit(characterId);
    });
  }



  /**
   * Forces a refresh of the pinboard data
   */
  private async refreshPinboardData(): Promise<void> {
    // Get current pinboard data
    const currentPinboardData = this.pinboardService.getPinboardData();
    let pinboardData: PinboardData | null = null;

    // Get the current value synchronously
    const subscription = currentPinboardData.subscribe((data) => {
      pinboardData = data;
    });
    subscription.unsubscribe();

    if (pinboardData) {
      await this.updatePinboard(pinboardData);
    }
  }

  /**
   * Saves the current zoom and pan state to project settings
   */
  private saveViewState(): void {
    if (!this.network) return;

    const viewPosition = this.network.getViewPosition();
    const state = {
      zoomIndex: this.currentZoomIndex,
      viewPosition: { x: viewPosition.x, y: viewPosition.y },
      showGrid: this.showGrid,
      snapToGrid: this.snapToGrid,
    };

    // Save asynchronously without blocking UI
    this.projectService.savePinboardViewState(state).catch((error) => {
      console.warn('Failed to save pinboard view state:', error);
    });
  }

  /**
   * Saves the current zoom and pan state for a specific pinboard
   */
  private async saveViewStateForPinboard(pinboardId: string): Promise<void> {
    if (!this.network) return;

    const viewPosition = this.network.getViewPosition();
    const state = {
      zoomIndex: this.currentZoomIndex,
      viewPosition: { x: viewPosition.x, y: viewPosition.y },
      showGrid: this.showGrid,
      snapToGrid: this.snapToGrid,
    };

    try {
      await this.projectService.savePinboardViewState(state, pinboardId);
    } catch (error) {
      console.warn('Failed to save pinboard view state:', error);
    }
  }

  /**
   * Restores the saved zoom and pan state from project settings
   */
  private restoreViewState(): void {
    if (!this.network) return;

    const state = this.projectService.getPinboardViewState();
    if (state) {
      // Restore zoom level
      if (state.zoomIndex >= 0 && state.zoomIndex < this.zoomLevels.length) {
        this.currentZoomIndex = state.zoomIndex;
      }

      // Restore grid settings
      if (state.showGrid !== undefined) {
        this.showGrid = state.showGrid;
      }
      if (state.snapToGrid !== undefined) {
        this.snapToGrid = state.snapToGrid;
      }

      // Restore view position
      setTimeout(() => {
        if (this.network) {
          this.network.moveTo({
            position: state.viewPosition,
            scale: this.zoomLevels[this.currentZoomIndex],
            animation: {
              duration: 300,
              easingFunction: 'easeInOutQuad',
            },
          });
        }
      }, 500); // Delay to ensure pinboard is fully initialized
    }
  }

  // Pinboard Management Methods
  onCreatePinboard(): void {
    this.showCreatePinboardDialog = true;
  }

  async onPinboardCreate(event: { name: string; duplicateFromId?: string }): Promise<void> {
    try {
      await this.projectService.createPinboard(event.name, event.duplicateFromId);
      this.showCreatePinboardDialog = false;
      
      // Switch to the newly created pinboard
      const pinboards = this.projectService.getPinboards();
      const newPinboard = pinboards.find(p => p.name === event.name);
      if (newPinboard) {
        await this.pinboardService.switchPinboard(newPinboard.id);
      }
    } catch (error: any) {
      this.notificationService.showError(error.message || 'Failed to create pinboard');
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
    } catch (error: any) {
      this.notificationService.showError(error.message || 'Failed to rename pinboard');
    }
  }

  async onDeletePinboard(id: string): Promise<void> {
    const confirmed = await this.modalService.confirm(
      'Are you sure you want to delete this pinboard? This action cannot be undone.',
      'Delete Pinboard',
      {
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true
      }
    );

    if (!confirmed) {
      return;
    }

    try {
      await this.projectService.deletePinboard(id);
      this.loadPinboards();
      
      // If we deleted the current pinboard, the service will have switched to another
      this.currentPinboard = this.projectService.getCurrentPinboard();
      if (this.currentPinboard) {
        await this.refreshPinboardData();
        this.restoreViewState();
      }
    } catch (error: any) {
      this.notificationService.showError(error.message || 'Failed to delete pinboard');
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

  // Node Hover Delete Methods
  onNodeHover(nodeId: string): void {
    this.hoveredNodeId = nodeId;
  }

  onNodeHoverEnd(): void {
    this.hoveredNodeId = null;
  }

  getHoveredNodePosition(): { x: number; y: number } | null {
    if (!this.hoveredNodeId || !this.network) {
      return null;
    }

    try {
      const positions = this.network.getPositions([this.hoveredNodeId]);
      const nodePosition = positions[this.hoveredNodeId];

      if (!nodePosition) {
        return null;
      }

      // Get the canvas element
      const canvas = this.pinboardContainer.nativeElement.querySelector('canvas');
      if (!canvas) {
        return null;
      }

      // Get the container (pinboard-container) for positioning
      const container = this.pinboardContainer.nativeElement.closest('.pinboard-container');
      if (!container) {
        return null;
      }

      // Use vis-network's canvasToDOM to convert network coordinates to DOM coordinates
      // This gives us the pixel position on the canvas
      const canvasPos = this.network.canvasToDOM(nodePosition);

      // Get the canvas position relative to the container
      const canvasRect = canvas.getBoundingClientRect();
      const containerRect = (container as HTMLElement).getBoundingClientRect();

      // Calculate the offset from canvas to container
      const canvasOffsetX = canvasRect.left - containerRect.left;
      const canvasOffsetY = canvasRect.top - containerRect.top;

      // Get node size (approximate, including thumbnail) - same as plus icon
      const nodeSize = 30;
      const deleteIconSize = 24; // Size of the delete icon
      const deleteIconOffset = nodeSize / 2 + deleteIconSize / 2 + 5; // Distance from node center

      // Position the delete icon to the top-right of the node
      // Using same calculation structure as plus icon, but offset upward
      return {
        x: canvasPos.x + deleteIconOffset + canvasOffsetX,
        y: canvasPos.y - deleteIconOffset + canvasOffsetY
      };
    } catch (error) {
      this.logger.error('Error calculating hovered node position:', error);
      return null;
    }
  }

  async removePinFromPinboard(nodeId: string): Promise<void> {
    const character = this.characters.find(c => c.id === nodeId);
    const characterName = character?.name || 'Character';

    if (!confirm(`Are you sure you want to remove "${characterName}" from the pinboard?`)) {
      return;
    }

    try {
      await this.pinboardService.removePin(nodeId);
    } catch (error) {
      this.logger.error('Failed to remove pin:', error);
      this.notificationService.showError('Failed to remove character from pinboard. Please try again.');
    }
  }
}
