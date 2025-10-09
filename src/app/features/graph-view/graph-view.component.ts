import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subscription } from 'rxjs';
import { GraphData, Character, Relationship } from '../../core/interfaces';
import { RelationshipService, CharacterService, ProjectService } from '../../core/services';
import { Network, DataSet, Node, Edge, Options } from 'vis-network/standalone';

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
  imports: [CommonModule, FormsModule],
  templateUrl: './graph-view.component.html',
  styleUrls: ['./graph-view.component.scss']
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
  selectedNodes: string[] = [];
  characters: Character[] = [];
  relationshipTypes: string[] = [];
  
  // Grid configuration
  gridSize = 40; // Default grid size
  showGrid = true;
  snapToGrid = true;
  
  // Form data
  relationshipForm: RelationshipFormData = {
    source: '',
    target: '',
    type: 'friend',
    label: '',
    color: '#848484',
    bidirectional: false
  };
  
  editingRelationship: Relationship | null = null;

  constructor(
    private relationshipService: RelationshipService,
    private characterService: CharacterService,
    private projectService: ProjectService
  ) {
    this.graphData$ = this.relationshipService.getGraphData();
    this.characters$ = this.characterService.getCharacters();
    this.relationshipTypes = this.relationshipService.getRelationshipTypes();
  }

  ngOnInit(): void {
    this.subscribeToData();
  }

  ngAfterViewInit(): void {
    // Initialize graph after view is ready
    setTimeout(() => {
      this.initializeGraph();
      // Force a refresh of the graph data after initialization
      this.refreshGraphData();
    }, 0);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    if (this.network) {
      this.network.destroy();
    }
  }

  private initializeGraph(): void {
    const container = this.graphContainer.nativeElement;
    
    const options: Options = {
      nodes: {
        shape: 'dot',
        size: 20,
        font: {
          size: 13,
          color: '#343434',
          face: 'Arial, sans-serif',
          align: 'center',
          multi: false,
          strokeWidth: 0
        },
        borderWidth: 2,
        shadow: true,
        labelHighlightBold: false
      },
      edges: {
        width: 2,
        color: { inherit: 'from' },
        smooth: {
          enabled: true,
          type: 'continuous',
          roundness: 0.5
        },
        arrows: {
          to: { enabled: true, scaleFactor: 1 }
        },
        font: {
          size: 12,
          color: '#343434'
        }
      },
      physics: {
        enabled: false, // Completely disable physics
        stabilization: false // Disable stabilization
      },
      layout: {
        randomSeed: undefined, // Disable random positioning
        improvedLayout: false, // Disable improved layout algorithm
        clusterThreshold: 150,
        hierarchical: false
      },
      interaction: {
        dragNodes: true,
        dragView: true,
        zoomView: true,
        selectConnectedEdges: false
      },
      manipulation: {
        enabled: false
      }
    };

    this.network = new Network(container, { nodes: this.nodes, edges: this.edges }, options);
    
    this.setupNetworkEvents();
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

    // Handle dragging with grid snapping
    this.network.on('dragging', (params) => {
      if (params.nodes.length > 0 && this.snapToGrid) {
        const positions = this.network!.getPositions(params.nodes);
        const snappedPositions: { [key: string]: { x: number; y: number } } = {};
        
        Object.keys(positions).forEach(nodeId => {
          const pos = positions[nodeId];
          snappedPositions[nodeId] = {
            x: Math.round(pos.x / this.gridSize) * this.gridSize,
            y: Math.round(pos.y / this.gridSize) * this.gridSize
          };
        });
        
        this.network!.moveNode(params.nodes[0], snappedPositions[params.nodes[0]].x, snappedPositions[params.nodes[0]].y);
      }
    });

    // Save node positions when dragging stops
    this.network.on('dragEnd', (params) => {
      if (params.nodes.length > 0) {
        const positions = this.network!.getPositions(params.nodes);
        
        // Apply grid snapping if enabled
        if (this.snapToGrid) {
          const snappedPositions: { [key: string]: { x: number; y: number } } = {};
          
          Object.keys(positions).forEach(nodeId => {
            const pos = positions[nodeId];
            snappedPositions[nodeId] = {
              x: Math.round(pos.x / this.gridSize) * this.gridSize,
              y: Math.round(pos.y / this.gridSize) * this.gridSize
            };
          });
          
          // Update positions in the network
          Object.keys(snappedPositions).forEach(nodeId => {
            this.network!.moveNode(nodeId, snappedPositions[nodeId].x, snappedPositions[nodeId].y);
          });
          
          // Save snapped positions
          Object.keys(snappedPositions).forEach(nodeId => {
            this.relationshipService.updateNodePosition(nodeId, snappedPositions[nodeId]);
          });
        } else {
          // Save original positions
          Object.keys(positions).forEach(nodeId => {
            this.relationshipService.updateNodePosition(nodeId, positions[nodeId]);
          });
        }
      }
    });

    // Handle zoom and pan events to redraw grid
    this.network.on('zoom', () => {
      this.redrawGrid();
    });

    this.network.on('dragEnd', () => {
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
    
    // Subscribe to character changes to ensure nodes exist
    this.subscriptions.add(
      this.characters$.subscribe(characters => {
        this.characters = characters;
        this.relationshipService.ensureNodesForCharacters(characters);
      })
    );

    // Subscribe to graph data changes
    this.subscriptions.add(
      this.graphData$.subscribe(async graphData => {
        await this.updateGraph(graphData);
      })
    );
  }

  private async updateGraph(graphData: GraphData): Promise<void> {
    if (!this.network) {
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

    // Explicitly set node positions after a short delay to ensure they're applied
    setTimeout(() => {
      this.enforceNodePositions(graphData);
    }, 100);
  }

  /**
   * Explicitly enforces node positions from stored data
   */
  private enforceNodePositions(graphData: GraphData): void {
    if (!this.network) return;

    for (const node of graphData.nodes) {
      this.network.moveNode(node.id, node.position.x, node.position.y);
    }
    
    // Disable physics to prevent any automatic repositioning
    this.network.setOptions({ physics: { enabled: false } });
  }

  private findRelationshipById(edgeId: string): Relationship | null {
    const currentData = this.relationshipService.getGraphData();
    // We need to get the current value synchronously
    let relationship: Relationship | null = null;
    this.subscriptions.add(
      currentData.subscribe(data => {
        relationship = data.edges.find(edge => edge.id === edgeId) || null;
      }).unsubscribe()
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
    const sub = currentData.subscribe(data => storedData = data);
    sub.unsubscribe();
    
  }

  onGridSizeChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const newSize = parseInt(target.value, 10);
    this.gridSize = Math.max(10, Math.min(100, newSize)); // Clamp between 10 and 100
    this.redrawGrid();
  }

  updateGridDisplay(): void {
    // Grid is now drawn via canvas in beforeDrawing event
    // Just trigger a redraw
    this.redrawGrid();
  }

  private redrawGrid(): void {
    if (this.network) {
      this.network.redraw();
    }
  }

  private drawGridOnCanvas(ctx: CanvasRenderingContext2D): void {
    if (!this.network) return;

    // Get the current view position and scale
    const scale = this.network.getScale();
    const viewPosition = this.network.getViewPosition();
    
    // Get canvas dimensions
    const canvas = ctx.canvas;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    
    // Calculate the world coordinates bounds
    const topLeftWorld = {
      x: (0 - canvasWidth / 2) / scale + viewPosition.x,
      y: (0 - canvasHeight / 2) / scale + viewPosition.y
    };
    
    const bottomRightWorld = {
      x: (canvasWidth - canvasWidth / 2) / scale + viewPosition.x,
      y: (canvasHeight - canvasHeight / 2) / scale + viewPosition.y
    };
    
    // Calculate grid bounds in world coordinates
    const startX = Math.floor(topLeftWorld.x / this.gridSize) * this.gridSize;
    const endX = Math.ceil(bottomRightWorld.x / this.gridSize) * this.gridSize;
    const startY = Math.floor(topLeftWorld.y / this.gridSize) * this.gridSize;
    const endY = Math.ceil(bottomRightWorld.y / this.gridSize) * this.gridSize;
    
    // Set grid line style
    ctx.strokeStyle = 'rgba(224, 224, 224, 0.4)';
    ctx.lineWidth = Math.max(0.5, 1 / scale); // Ensure minimum visibility
    ctx.setLineDash([]);
    
    ctx.beginPath();
    
    // Draw vertical lines
    for (let x = startX; x <= endX; x += this.gridSize) {
      const canvasX = (x - viewPosition.x) * scale + canvasWidth / 2;
      ctx.moveTo(canvasX, 0);
      ctx.lineTo(canvasX, canvasHeight);
    }
    
    // Draw horizontal lines
    for (let y = startY; y <= endY; y += this.gridSize) {
      const canvasY = (y - viewPosition.y) * scale + canvasHeight / 2;
      ctx.moveTo(0, canvasY);
      ctx.lineTo(canvasWidth, canvasY);
    }
    
    ctx.stroke();
  }

  // Relationship Dialog Methods
  openRelationshipDialog(sourceId: string, targetId: string): void {
    const sourceChar = this.characters.find(c => c.id === sourceId);
    const targetChar = this.characters.find(c => c.id === targetId);
    
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
      bidirectional: false
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
      bidirectional: relationship.bidirectional
    };
    this.showEditDialog = true;
  }

  async saveRelationship(): Promise<void> {
    try {
      if (this.editingRelationship) {
        // Update existing relationship
        await this.relationshipService.updateRelationship(
          this.editingRelationship.id,
          this.relationshipForm
        );
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
    this.editingRelationship = null;
    this.relationshipForm = {
      source: '',
      target: '',
      type: 'friend',
      label: '',
      color: '#848484',
      bidirectional: false
    };
  }

  // Helper methods
  getCharacterName(characterId: string): string {
    const character = this.characters.find(c => c.id === characterId);
    return character ? character.name : 'Unknown';
  }

  getRelationshipTypeColor(type: string): string {
    const colors: { [key: string]: string } = {
      'family': '#e74c3c',
      'friend': '#2ecc71',
      'enemy': '#c0392b',
      'romantic': '#e91e63',
      'mentor': '#9b59b6',
      'colleague': '#3498db',
      'rival': '#f39c12',
      'ally': '#1abc9c',
      'subordinate': '#95a5a6',
      'superior': '#34495e'
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
    const subscription = currentGraphData.subscribe(data => {
      graphData = data;
    });
    subscription.unsubscribe();
    
    if (graphData) {
      await this.updateGraph(graphData);
    }
  }
}