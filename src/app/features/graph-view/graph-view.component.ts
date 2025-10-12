import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, Subscription } from 'rxjs';
import { DataSet, Edge, Network, Node, Options } from 'vis-network/standalone';
import { Character, GraphData, Relationship } from '../../core/interfaces';
import { CharacterService, ProjectService, RelationshipService, ElectronService } from '../../core/services';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

interface RelationshipFormData {
  source: string;
  target: string;
  type: string;
  label: string;
  color: string;
  bidirectional: boolean;
}

@Component({
  selector: 'app-graph-view',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  templateUrl: './graph-view.component.html',
  styleUrls: ['./graph-view.component.scss'],
})
export class GraphViewComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('graphContainer', { static: true }) graphContainer!: ElementRef;

  graphData$: Observable<GraphData>;
  characters$: Observable<Character[]>;

  private subscriptions = new Subscription();
  private network: Network | null = null;
  private nodes: DataSet<Node> = new DataSet([]);
  private edges: DataSet<Edge> = new DataSet([]);

  // UI state
  showRelationshipDialog = false;
  showEditDialog = false;
  showAddNodeDialog = false;
  selectedNodes: string[] = [];
  characters: Character[] = [];
  relationshipTypes: string[] = [];

  // Add node dialog state
  characterFilter = '';
  filteredCharacters: Character[] = [];
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
  relationshipForm: RelationshipFormData = {
    source: '',
    target: '',
    type: 'friend',
    label: '',
    color: '#848484',
    bidirectional: false,
  };

  editingRelationship: Relationship | null = null;

  constructor(
    private relationshipService: RelationshipService,
    private characterService: CharacterService,
    private projectService: ProjectService,
    private electronService: ElectronService
  ) {
    this.graphData$ = this.relationshipService.getGraphData();
    this.characters$ = this.characterService.getCharacters();
    this.relationshipTypes = this.relationshipService.getRelationshipTypes();
  }

  ngOnInit(): void {
    // Check if project is loaded
    const project = this.projectService.getCurrentProject();

    if (!project) {
      console.error('No project loaded in graph view!');
      return;
    }

    this.subscribeToData();
  }

  ngAfterViewInit(): void {
    // Initialize graph after view is ready
    setTimeout(() => {
      this.initializeGraph();
      // Force a refresh of the graph data after initialization
      this.refreshGraphData();
      // Restore saved view state
      this.restoreViewState();
    }, 0);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    if (this.network) {
      this.network.destroy();
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  handleEscapeKey(event: KeyboardEvent): void {
    if (this.showAddNodeDialog || this.showRelationshipDialog || this.showEditDialog) {
      event.preventDefault();
      this.closeDialogs();
    }
  }

  private initializeGraph(): void {
    const container = this.graphContainer.nativeElement;

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
      },
      manipulation: {
        enabled: false,
      },
    };

    this.network = new Network(container, { nodes: this.nodes, edges: this.edges }, options);

    this.setupNetworkEvents();
    this.setupDiscreteZoom();
    this.setupMiddleClickPan();
  }

  private setupDiscreteZoom(): void {
    if (!this.network) return;

    // Override the default zoom behavior
    const canvas = this.graphContainer.nativeElement.querySelector('canvas');
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

    const canvas = this.graphContainer.nativeElement.querySelector('canvas');
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

    // Prevent context menu on middle click
    canvas.addEventListener('contextmenu', (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    });
  }

  private setupNetworkEvents(): void {
    if (!this.network) return;

    // Handle node selection for relationship creation
    this.network.on('selectNode', (params) => {
      this.selectedNodes = params.nodes;
    });

    // Handle edge selection for editing
    this.network.on('selectEdge', (params) => {
      if (params.edges.length > 0) {
        const edgeId = params.edges[0];
        const relationship = this.findRelationshipById(edgeId);
        if (relationship) {
          this.openEditDialog(relationship);
        }
      }
    });

    // Handle double-click on canvas for relationship creation
    this.network.on('doubleClick', (params) => {
      if (params.nodes.length === 2) {
        this.openRelationshipDialog(params.nodes[0], params.nodes[1]);
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
            this.relationshipService.updateNodePosition(nodeId, snappedPositions[nodeId]);
          });
        } else {
          // Save original positions (no snapping, but still check collisions)
          Object.keys(positions).forEach((nodeId) => {
            let finalPos = positions[nodeId];

            // Check for collisions
            for (const [otherId, otherPos] of Object.entries(allPositions)) {
              if (otherId !== nodeId) {
                if (Math.abs(otherPos.x - finalPos.x) < 1 && Math.abs(otherPos.y - finalPos.y) < 1) {
                  // Position is occupied, don't save (node will snap back)
                  return;
                }
              }
            }

            this.relationshipService.updateNodePosition(nodeId, finalPos);
          });
        }
      }
    });

    // Handle zoom and pan events to redraw grid
    this.network.on('zoom', () => {
      this.redrawGrid();
      this.constrainView();
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
        this.characters = characters;
        // Load thumbnails for character selection dialog
        await this.loadThumbnailDataUrls(characters);
        // No longer automatically adding nodes for all characters
      })
    );

    // Subscribe to graph data changes
    this.subscriptions.add(
      this.graphData$.subscribe(async (graphData) => {
        await this.updateGraph(graphData);
      })
    );
  }

  private async updateGraph(graphData: GraphData): Promise<void> {
    if (!this.network) {
      console.warn('updateGraph called but network is not initialized');
      return;
    }

    // Convert to vis.js format with thumbnails loaded dynamically
    const visData = await this.relationshipService.getVisJsDataWithThumbnails(this.characters);

    // Update nodes
    this.nodes.clear();
    this.nodes.add(visData.nodes);

    // Update edges
    this.edges.clear();
    this.edges.add(visData.edges);

    // Force redraw to ensure positions are applied
    this.network.redraw();

    // Explicitly enforce node positions immediately and again after a short delay
    this.enforceNodePositions(graphData);
    setTimeout(() => {
      this.enforceNodePositions(graphData);
    }, 50);
  }

  /**
   * Explicitly enforces node positions from stored data
   */
  private enforceNodePositions(graphData: GraphData): void {
    if (!this.network) return;

    for (const node of graphData.nodes) {
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

  private findRelationshipById(edgeId: string): Relationship | null {
    const currentData = this.relationshipService.getGraphData();
    // We need to get the current value synchronously
    let relationship: Relationship | null = null;
    this.subscriptions.add(
      currentData
        .subscribe((data) => {
          relationship = data.edges.find((edge) => edge.id === edgeId) || null;
        })
        .unsubscribe()
    );
    return relationship;
  }

  // UI Event Handlers
  onCreateRelationship(): void {
    if (this.selectedNodes.length === 2) {
      this.openRelationshipDialog(this.selectedNodes[0], this.selectedNodes[1]);
    } else {
      alert('Please select exactly two characters to create a relationship.');
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
  }

  onToggleSnapToGrid(): void {
    this.snapToGrid = !this.snapToGrid;
  }

  onRefreshGraph(): void {
    this.refreshGraphData();
  }

  onDebugPositions(): void {
    if (!this.network) return;

    // Get current vis.js positions
    const visPositions = this.network.getPositions();

    // Get stored positions from service
    this.relationshipService.debugLogGraphState();

    // Compare them
    const currentData = this.relationshipService.getGraphData();
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

    // Get canvas dimensions
    const canvas = ctx.canvas;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // Center of the canvas
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    // Grid size in screen pixels
    const gridScreenSize = this.gridSize * scale;

    // Calculate the offset based on view position
    // This determines where grid (0,0) appears on screen
    const offsetX = (centerX - viewPosition.x * scale) % gridScreenSize;
    const offsetY = (centerY - viewPosition.y * scale) % gridScreenSize;

    // Set grid line style - dark theme
    ctx.strokeStyle = 'rgba(45, 55, 72, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    ctx.beginPath();

    // Draw vertical lines
    for (let x = offsetX; x < canvasWidth; x += gridScreenSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
    }
    for (let x = offsetX - gridScreenSize; x > 0; x -= gridScreenSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
    }

    // Draw horizontal lines
    for (let y = offsetY; y < canvasHeight; y += gridScreenSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
    }
    for (let y = offsetY - gridScreenSize; y > 0; y -= gridScreenSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
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
    const canvas = this.graphContainer.nativeElement.querySelector('canvas');
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

  // Relationship Dialog Methods
  openRelationshipDialog(sourceId: string, targetId: string): void {
    const sourceChar = this.characters.find((c) => c.id === sourceId);
    const targetChar = this.characters.find((c) => c.id === targetId);

    if (!sourceChar || !targetChar) {
      alert('Invalid character selection.');
      return;
    }

    this.relationshipForm = {
      source: sourceId,
      target: targetId,
      type: 'friend',
      label: `${sourceChar.name} - ${targetChar.name}`,
      color: '#848484',
      bidirectional: false,
    };

    this.showRelationshipDialog = true;
  }

  openEditDialog(relationship: Relationship): void {
    this.editingRelationship = relationship;
    this.relationshipForm = {
      source: relationship.source,
      target: relationship.target,
      type: relationship.type,
      label: relationship.label,
      color: relationship.color,
      bidirectional: relationship.bidirectional,
    };
    this.showEditDialog = true;
  }

  async saveRelationship(): Promise<void> {
    try {
      if (this.editingRelationship) {
        // Update existing relationship
        await this.relationshipService.updateRelationship(this.editingRelationship.id, this.relationshipForm);
      } else {
        // Create new relationship
        await this.relationshipService.createRelationship(this.relationshipForm);
      }

      this.closeDialogs();
    } catch (error) {
      alert('Failed to save relationship. Please try again.');
    }
  }

  async deleteRelationship(): Promise<void> {
    if (!this.editingRelationship) return;

    if (confirm('Are you sure you want to delete this relationship?')) {
      try {
        await this.relationshipService.deleteRelationship(this.editingRelationship.id);
        this.closeDialogs();
      } catch (error) {
        alert('Failed to delete relationship. Please try again.');
      }
    }
  }

  closeDialogs(): void {
    this.showRelationshipDialog = false;
    this.showEditDialog = false;
    this.showAddNodeDialog = false;
    this.editingRelationship = null;
    this.characterFilter = '';
    this.filteredCharacters = [];
    this.relationshipForm = {
      source: '',
      target: '',
      type: 'friend',
      label: '',
      color: '#848484',
      bidirectional: false,
    };
  }

  // Add Node Dialog Methods
  openAddNodeDialog(): void {
    this.characterFilter = '';
    this.updateFilteredCharacters();
    this.showAddNodeDialog = true;
  }

  updateFilteredCharacters(): void {
    const currentGraphData = this.relationshipService.getGraphData();
    let graphNodes: string[] = [];

    // Get current nodes synchronously
    const sub = currentGraphData.subscribe(data => {
      graphNodes = data.nodes.map(node => node.id);
    });
    sub.unsubscribe();

    // Filter out characters that are already in the graph
    let availableCharacters = this.characters.filter(char => !graphNodes.includes(char.id));

    // Apply search filter if present
    if (this.characterFilter.trim()) {
      const filter = this.characterFilter.toLowerCase();
      availableCharacters = availableCharacters.filter(char =>
        char.name.toLowerCase().includes(filter) ||
        char.category.toLowerCase().includes(filter)
      );
    }

    this.filteredCharacters = availableCharacters;
  }

  async addCharacterToGraph(character: Character): Promise<void> {
    try {
      console.log('Adding character to graph:', character.name, 'gridSize:', this.gridSize);
      await this.relationshipService.addNode(character, this.gridSize);
      console.log('Character added successfully');
      this.closeDialogs();
    } catch (error) {
      console.error('Failed to add character to graph:', error);
      console.error('Error details:', error);
      alert(`Failed to add character to graph: ${error}`);
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

  private async loadThumbnailDataUrls(characters: Character[]): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) return;

    for (const character of characters) {
      if (character.thumbnail && !this.thumbnailDataUrls.has(character.id)) {
        try {
          const thumbnailPath = `${project.path}/thumbnails/${character.thumbnail}`;
          const dataUrl = await this.electronService.getImageAsDataUrl(thumbnailPath);
          if (dataUrl) {
            this.thumbnailDataUrls.set(character.id, dataUrl);
          }
        } catch (error) {
          console.error(`Failed to load thumbnail for character ${character.name}:`, error);
        }
      }
    }
  }

  // Helper methods
  getCharacterName(characterId: string): string {
    const character = this.characters.find((c) => c.id === characterId);
    return character ? character.name : 'Unknown';
  }

  getRelationshipTypeColor(type: string): string {
    const colors: { [key: string]: string } = {
      family: '#e74c3c',
      friend: '#2ecc71',
      enemy: '#c0392b',
      romantic: '#e91e63',
      mentor: '#9b59b6',
      colleague: '#3498db',
      rival: '#f39c12',
      ally: '#1abc9c',
      subordinate: '#95a5a6',
      superior: '#34495e',
    };
    return colors[type] || '#848484';
  }

  onRelationshipTypeChange(): void {
    this.relationshipForm.color = this.getRelationshipTypeColor(this.relationshipForm.type);
  }

  getLegendItems() {
    const project = this.projectService.getCurrentProject();
    return project?.metadata.categories || [];
  }

  /**
   * Forces a refresh of the graph data
   */
  private async refreshGraphData(): Promise<void> {
    // Get current graph data
    const currentGraphData = this.relationshipService.getGraphData();
    let graphData: GraphData | null = null;

    // Get the current value synchronously
    const subscription = currentGraphData.subscribe((data) => {
      graphData = data;
    });
    subscription.unsubscribe();

    if (graphData) {
      await this.updateGraph(graphData);
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
    };

    // Save asynchronously without blocking UI
    this.projectService.saveGraphViewState(state).catch((error) => {
      console.warn('Failed to save graph view state:', error);
    });
  }

  /**
   * Restores the saved zoom and pan state from project settings
   */
  private restoreViewState(): void {
    if (!this.network) return;

    const state = this.projectService.getGraphViewState();
    if (state) {
      // Restore zoom level
      if (state.zoomIndex >= 0 && state.zoomIndex < this.zoomLevels.length) {
        this.currentZoomIndex = state.zoomIndex;
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
      }, 500); // Delay to ensure graph is fully initialized
    }
  }
}
