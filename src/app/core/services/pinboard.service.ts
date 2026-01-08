import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { PinboardConnection, PinboardPin, PinboardData } from '../interfaces/pinboard.interface';
import { generateId } from '../utils/id.utils';
import { pathJoin } from '../utils/path.utils';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { CharacterService } from './character.service';

@Injectable({
  providedIn: 'root'
})
export class PinboardService {
  private pinboardDataSubject = new BehaviorSubject<PinboardData>({ nodes: [], edges: [] });
  public pinboardData$ = this.pinboardDataSubject.asObservable();
  private currentPinboardIdSubject = new BehaviorSubject<string | null>(null);
  public currentPinboardId$ = this.currentPinboardIdSubject.asObservable();
  private currentProjectPath: string | null = null;
  private pinboardLoaded = false;

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private characterService: CharacterService
  ) {
    // Subscribe to project changes to load pinboard data
    this.projectService.currentProject$.subscribe(project => {
      if (project && project.path !== this.currentProjectPath) {
        this.currentProjectPath = project.path;
        this.loadPinboardFromProject(project);
      } else if (!project) {
        this.currentProjectPath = null;
        this.pinboardDataSubject.next({ nodes: [], edges: [] });
        this.currentPinboardIdSubject.next(null);
      } else if (project) {
        // Project path unchanged, but check if pinboard changed
        const currentPinboardId = project.metadata.currentPinboardId;
        const previousPinboardId = this.currentPinboardIdSubject.value;
        if (currentPinboardId !== previousPinboardId) {
          this.loadPinboardFromProject(project);
        }
      }
    });
  }

  /**
   * Loads pinboard data from the current active pinboard
   */
  private loadPinboardFromProject(project: any): void {
    const currentPinboard = this.projectService.getCurrentPinboard();
    const currentPinboardId = project?.metadata?.currentPinboardId || null;

    // Ensure the data structure is valid
    const validPinboard = {
      nodes: currentPinboard?.nodes || [],
      edges: currentPinboard?.edges || []
    };

    this.pinboardLoaded = true;
    this.currentPinboardIdSubject.next(currentPinboardId);
    this.pinboardDataSubject.next(validPinboard);
  }

  /**
   * Switches to a different pinboard
   */
  async switchPinboard(id: string): Promise<void> {
    await this.projectService.setCurrentPinboard(id);
    const project = this.projectService.getCurrentProject();
    if (project) {
      this.loadPinboardFromProject(project);
    }
  }

  getPinboardData(): Observable<PinboardData> {
    return this.pinboardData$;
  }

  /**
   * @deprecated Use getPinboardData() instead
   * Legacy method for backward compatibility
   */
  getGraphData(): Observable<PinboardData> {
    return this.pinboardData$;
  }

  /**
   * @deprecated This method is no longer used - pinboard data is loaded from ensemble.json via ProjectService
   */
  async loadRelationships(projectPath: string): Promise<void> {
    // No-op: pinboard data is now loaded from project metadata
  }

  /**
   * Creates a new connection and saves to ensemble.json
   */
  async createConnection(connection: Omit<PinboardConnection, 'id'>): Promise<PinboardConnection> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const newConnection: PinboardConnection = {
      id: generateId(),
      ...connection
    };

    const currentData = this.pinboardDataSubject.value;
    const updatedData = {
      ...currentData,
      edges: [...currentData.edges, newConnection]
    };

    await this.projectService.updatePinboard(updatedData);
    this.pinboardDataSubject.next(updatedData);

    return newConnection;
  }

  /**
   * @deprecated Use createConnection() instead
   * Legacy method for backward compatibility
   */
  async createRelationship(relationship: Omit<PinboardConnection, 'id'>): Promise<PinboardConnection> {
    return this.createConnection(relationship);
  }

  /**
   * Updates an existing connection and saves to ensemble.json
   */
  async updateConnection(id: string, updates: Partial<PinboardConnection>): Promise<PinboardConnection | null> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const currentData = this.pinboardDataSubject.value;
    const edgeIndex = currentData.edges.findIndex(edge => edge.id === id);

    if (edgeIndex === -1) return null;

    const updatedEdge = { ...currentData.edges[edgeIndex], ...updates };
    const updatedEdges = [...currentData.edges];
    updatedEdges[edgeIndex] = updatedEdge;

    const updatedData = {
      ...currentData,
      edges: updatedEdges
    };

    await this.projectService.updatePinboard(updatedData);
    this.pinboardDataSubject.next(updatedData);

    return updatedEdge;
  }

  /**
   * @deprecated Use updateConnection() instead
   * Legacy method for backward compatibility
   */
  async updateRelationship(id: string, updates: Partial<PinboardConnection>): Promise<PinboardConnection | null> {
    return this.updateConnection(id, updates);
  }

  /**
   * Deletes a connection and saves to ensemble.json
   */
  async deleteConnection(id: string): Promise<boolean> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const currentData = this.pinboardDataSubject.value;
    const filteredEdges = currentData.edges.filter(edge => edge.id !== id);

    if (filteredEdges.length === currentData.edges.length) return false;

    const updatedData = {
      ...currentData,
      edges: filteredEdges
    };

    await this.projectService.updatePinboard(updatedData);
    this.pinboardDataSubject.next(updatedData);

    return true;
  }

  /**
   * @deprecated Use deleteConnection() instead
   * Legacy method for backward compatibility
   */
  async deleteRelationship(id: string): Promise<boolean> {
    return this.deleteConnection(id);
  }

  /**
   * Updates pin position and saves to ensemble.json
   */
  async updatePinPosition(pinId: string, position: { x: number; y: number }): Promise<void> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const currentData = this.pinboardDataSubject.value;
    const pinIndex = currentData.nodes.findIndex(node => node.id === pinId);

    if (pinIndex === -1) {
      return;
    }

    const updatedNodes = [...currentData.nodes];
    updatedNodes[pinIndex] = { ...updatedNodes[pinIndex], position };

    const updatedData = {
      ...currentData,
      nodes: updatedNodes
    };

    await this.projectService.updatePinboard(updatedData);
    this.pinboardDataSubject.next(updatedData);
  }

  /**
   * @deprecated Use updatePinPosition() instead
   * Legacy method for backward compatibility
   */
  async updateNodePosition(nodeId: string, position: { x: number; y: number }): Promise<void> {
    return this.updatePinPosition(nodeId, position);
  }

  /**
   * Ensures pins exist for all characters without overwriting existing positions
   */
  async ensurePinsForCharacters(characters: any[]): Promise<void> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    // Don't sync pins until pinboard has been loaded
    if (!this.pinboardLoaded) {
      return;
    }

    const currentData = this.pinboardDataSubject.value;
    const existingPins = new Map(currentData.nodes.map(node => [node.id, node]));
    const characterIds = new Set(characters.map(char => char.id));
    
    let hasChanges = false;
    
    // Start with existing pins
    const updatedPins: PinboardPin[] = [...currentData.nodes];
    
    // Add pins for new characters
    for (const character of characters) {
      if (!existingPins.has(character.id)) {
        const newPosition = this.generateDefaultPosition(character.id);
        updatedPins.push({
          id: character.id,
          name: character.name,
          position: newPosition,
          category: character.category
        });
        hasChanges = true;
      } else {
        // Update existing pin properties (but preserve position)
        const existingPin = existingPins.get(character.id)!;
        const pinIndex = updatedPins.findIndex(n => n.id === character.id);
        if (pinIndex !== -1) {
          const updatedPin = {
            ...existingPin,
            name: character.name,
            category: character.category
            // Keep existing position
          };
          
          // Check if anything actually changed
          if (JSON.stringify(updatedPin) !== JSON.stringify(existingPin)) {
            updatedPins[pinIndex] = updatedPin;
            hasChanges = true;
          }
        }
      }
    }
    
    // Remove pins for deleted characters
    const filteredPins = updatedPins.filter(node => characterIds.has(node.id));
    if (filteredPins.length !== updatedPins.length) {
      hasChanges = true;
    }

    // Remove connections for deleted characters (referential integrity)
    const validEdges = currentData.edges.filter(edge => 
      characterIds.has(edge.source) && characterIds.has(edge.target)
    );

    if (hasChanges || validEdges.length !== currentData.edges.length) {
      const updatedData = {
        nodes: filteredPins,
        edges: validEdges
      };

      await this.projectService.updatePinboard(updatedData);
      this.pinboardDataSubject.next(updatedData);
    }
  }

  /**
   * @deprecated Use ensurePinsForCharacters instead
   * Legacy method for backward compatibility
   */
  async ensureNodesForCharacters(characters: any[]): Promise<void> {
    return this.ensurePinsForCharacters(characters);
  }

  /**
   * @deprecated Use ensurePinsForCharacters instead
   * Synchronizes pins with character data and maintains referential integrity
   */
  async syncNodesWithCharacters(characters: any[]): Promise<void> {
    return this.ensurePinsForCharacters(characters);
  }

  /**
   * Removes all connections for a specific character (for referential integrity)
   */
  async removeCharacterConnections(characterId: string): Promise<void> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const currentData = this.pinboardDataSubject.value;

    // Remove the pin
    const updatedNodes = currentData.nodes.filter(node => node.id !== characterId);

    // Remove all edges involving this character
    const updatedEdges = currentData.edges.filter(edge =>
      edge.source !== characterId && edge.target !== characterId
    );

    const updatedData = {
      nodes: updatedNodes,
      edges: updatedEdges
    };

    await this.projectService.updatePinboard(updatedData);
    this.pinboardDataSubject.next(updatedData);
  }

  /**
   * @deprecated Use removeCharacterConnections() instead
   * Legacy method for backward compatibility
   */
  async removeCharacterRelationships(characterId: string): Promise<void> {
    return this.removeCharacterConnections(characterId);
  }

  /**
   * Converts pinboard data to vis.js Network format (without images)
   * @deprecated Use getVisJsDataWithThumbnails instead
   */
  getVisJsData(): { nodes: any[], edges: any[] } {
    const currentData = this.pinboardDataSubject.value;
    
    const visNodes = currentData.nodes.map(node => {
      const baseNode: any = {
        id: node.id,
        label: node.name,
        x: node.position.x,
        y: node.position.y,
        font: {
          color: '#ffffff',
          size: 14,
          face: 'Arial',
          strokeWidth: 2,
          strokeColor: '#000000'
        },
        borderWidth: 2,
        borderWidthSelected: 3,
        shape: 'dot',
        size: 30,
        color: {
          background: '#e0e0e0',
          border: '#999999'
        }
      };

      return baseNode;
    });

    // Group edges by node pairs to handle multiple connections between same nodes
    const edgePairCounts = new Map<string, number>();
    const edgePairIndex = new Map<string, number>();
    
    // Count edges between each pair of nodes
    currentData.edges.forEach(edge => {
      const pairKey = [edge.source, edge.target].sort().join('|');
      edgePairCounts.set(pairKey, (edgePairCounts.get(pairKey) || 0) + 1);
    });
    
    const visEdges = currentData.edges.map(edge => {
      // Determine arrows based on arrowFrom/arrowTo or bidirectional (for backward compatibility)
      let arrows: string | object = {};
      
      // Check if we're using the new format (both arrowFrom and arrowTo are explicitly set)
      const usingNewFormat = edge.arrowFrom !== undefined && edge.arrowTo !== undefined;
      
      if (usingNewFormat) {
        // New format: use arrowFrom/arrowTo explicitly
        // Both are explicitly set (could be true or false)
        if (edge.arrowFrom && edge.arrowTo) {
          arrows = { to: { enabled: true }, from: { enabled: true } };
        } else if (edge.arrowFrom && !edge.arrowTo) {
          arrows = { to: { enabled: false }, from: { enabled: true } };
        } else if (!edge.arrowFrom && edge.arrowTo) {
          arrows = { to: { enabled: true }, from: { enabled: false } };
        } else {
          // Both are false - explicitly disable both arrows
          arrows = { to: { enabled: false }, from: { enabled: false } };
        }
      } else {
        // Legacy format: use bidirectional
        if (edge.bidirectional) {
          arrows = { to: { enabled: true }, from: { enabled: true } };
        } else {
          arrows = { to: { enabled: true }, from: { enabled: false } }; // Default old behavior
        }
      }
      
      // Calculate smooth settings for multiple edges between same nodes
      const pairKey = [edge.source, edge.target].sort().join('|');
      const totalEdges = edgePairCounts.get(pairKey) || 1;
      const currentIndex = edgePairIndex.get(pairKey) || 0;
      edgePairIndex.set(pairKey, currentIndex + 1);
      
      let smooth: any = { enabled: true, type: 'continuous', roundness: 0.5 };
      if (totalEdges > 1) {
        const isEven = currentIndex % 2 === 0;
        const roundnessBase = 0.2 + (Math.floor(currentIndex / 2) * 0.15);
        smooth = {
          enabled: true,
          type: isEven ? 'curvedCW' : 'curvedCCW',
          roundness: Math.min(roundnessBase, 0.8)
        };
      }
      
      return {
        id: edge.id,
        from: edge.source,
        to: edge.target,
        label: edge.label || '',
        color: {
          color: edge.color || '#848484'
        },
        arrows: arrows,
        smooth: smooth,
        font: {
          color: edge.labelColor || '#ffffff',
          size: 12,
          strokeWidth: 2,
          strokeColor: '#000000'
        }
      };
    });

    return { nodes: visNodes, edges: visEdges };
  }

  /**
   * Gets vis.js data with character images loaded dynamically
   */
  async getVisJsDataWithThumbnails(characters: any[]): Promise<{ nodes: any[], edges: any[] }> {
    const currentData = this.pinboardDataSubject.value;
    const characterMap = new Map(characters.map(char => [char.id, char]));
    
    const visNodes = await Promise.all(currentData.nodes.map(async node => {
      const character = characterMap.get(node.id);
      
      const baseNode: any = {
        id: node.id,
        label: node.name,
        x: node.position.x,
        y: node.position.y,
        font: {
          color: '#ffffff',
          size: 14,
          face: 'Arial, sans-serif',
          align: 'center',
          multi: false,
          strokeWidth: 2,
          strokeColor: '#000000',
          bold: '500'
        },
        labelHighlightBold: false,
        fixed: {
          x: false, // Allow manual x positioning
          y: false  // Allow manual y positioning
        },
        physics: false // Disable physics for this node
      };

      // Try to load character image
      let imageDataUrl: string | null = null;
      
      if (character) {
        try {
          // Get primary image from character's image library
          const primaryImage = this.characterService.getPrimaryImage(character);
          
          if (primaryImage && character.folderPath) {
            // Try new location first (images/ subfolder), then old location (root)
            let imagePath: string;
            
            if (primaryImage.filename.includes('/')) {
              // Filename includes path, use as-is
              imagePath = pathJoin(character.folderPath, primaryImage.filename);
            } else {
              // Try images/ folder first
              const newPath = pathJoin(character.folderPath, 'images', primaryImage.filename);
              const existsInNew = await this.electronService.fileExists(newPath);
              
              if (existsInNew) {
                imagePath = newPath;
              } else {
                // Fall back to root folder
                imagePath = pathJoin(character.folderPath, primaryImage.filename);
              }
            }
            
            imageDataUrl = await this.electronService.getImageAsDataUrl(imagePath);
          }
        } catch (error) {
          console.warn(`Failed to load image for character ${node.id}:`, error);
        }
      }
      
      // Use image if available, otherwise use neutral circle
      if (imageDataUrl) {
        baseNode.shape = 'circularImage';
        baseNode.image = imageDataUrl;
        baseNode.size = 50;
        baseNode.color = {
          border: '#cccccc',
          background: '#ffffff'
        };
      } else {
        // No image - use neutral gray circle
        baseNode.shape = 'dot';
        baseNode.size = 30;
        baseNode.color = {
          background: '#e0e0e0',
          border: '#999999'
        };
      }

      return baseNode;
    }));

    // Group edges by node pairs to handle multiple connections between same nodes
    const edgePairCounts = new Map<string, number>();
    const edgePairIndex = new Map<string, number>();
    
    // Count edges between each pair of nodes
    currentData.edges.forEach(edge => {
      // Create a consistent key for the node pair (sorted to treat A-B same as B-A)
      const pairKey = [edge.source, edge.target].sort().join('|');
      edgePairCounts.set(pairKey, (edgePairCounts.get(pairKey) || 0) + 1);
    });
    
    const visEdges = currentData.edges.map(edge => {
      // Determine arrows based on arrowFrom/arrowTo or bidirectional (for backward compatibility)
      let arrows: string | object = {};
      
      // Check if we're using the new format (both arrowFrom and arrowTo are explicitly set)
      const usingNewFormat = edge.arrowFrom !== undefined && edge.arrowTo !== undefined;
      
      if (usingNewFormat) {
        // New format: use arrowFrom/arrowTo explicitly
        // Both are explicitly set (could be true or false)
        if (edge.arrowFrom && edge.arrowTo) {
          arrows = { to: { enabled: true }, from: { enabled: true } };
        } else if (edge.arrowFrom && !edge.arrowTo) {
          arrows = { to: { enabled: false }, from: { enabled: true } };
        } else if (!edge.arrowFrom && edge.arrowTo) {
          arrows = { to: { enabled: true }, from: { enabled: false } };
        } else {
          // Both are false - explicitly disable both arrows
          arrows = { to: { enabled: false }, from: { enabled: false } };
        }
      } else {
        // Legacy format: use bidirectional
        if (edge.bidirectional) {
          arrows = { to: { enabled: true }, from: { enabled: true } };
        } else {
          arrows = { to: { enabled: true }, from: { enabled: false } }; // Default old behavior
        }
      }
      
      // Calculate smooth settings for multiple edges between same nodes
      const pairKey = [edge.source, edge.target].sort().join('|');
      const totalEdges = edgePairCounts.get(pairKey) || 1;
      const currentIndex = edgePairIndex.get(pairKey) || 0;
      edgePairIndex.set(pairKey, currentIndex + 1);
      
      // Default smooth settings
      let smooth: any = {
        enabled: true,
        type: 'continuous',
        roundness: 0.5
      };
      
      // If there are multiple edges between the same nodes, curve them differently
      if (totalEdges > 1) {
        // Alternate between curvedCW and curvedCCW with varying roundness
        const isEven = currentIndex % 2 === 0;
        const roundnessBase = 0.2 + (Math.floor(currentIndex / 2) * 0.15);
        smooth = {
          enabled: true,
          type: isEven ? 'curvedCW' : 'curvedCCW',
          roundness: Math.min(roundnessBase, 0.8) // Cap at 0.8
        };
      }
      
      return {
        id: edge.id,
        from: edge.source,
        to: edge.target,
        label: edge.label || '', // Show label only if not empty
        color: {
          color: edge.color || '#848484'
        },
        arrows: arrows,
        smooth: smooth,
        font: {
          color: edge.labelColor || '#ffffff',
          size: 12,
          strokeWidth: 2,
          strokeColor: '#000000'
        }
      };
    });

    return { nodes: visNodes, edges: visEdges };
  }

  /**
   * Updates pinboard data from vis.js Network positions
   */
  async updateFromVisJsPositions(positions: { [pinId: string]: { x: number; y: number } }): Promise<void> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const currentData = this.pinboardDataSubject.value;
    const updatedNodes = currentData.nodes.map(node => ({
      ...node,
      position: positions[node.id] || node.position
    }));

    const updatedData = {
      ...currentData,
      nodes: updatedNodes
    };

    await this.projectService.updatePinboard(updatedData);
    this.pinboardDataSubject.next(updatedData);
  }

  /**
   * Gets available connection types
   */
  getConnectionTypes(): string[] {
    return [
      'family',
      'friend',
      'enemy',
      'romantic',
      'mentor',
      'colleague',
      'rival',
      'ally',
      'subordinate',
      'superior'
    ];
  }

  /**
   * @deprecated Use getConnectionTypes() instead
   * Legacy method for backward compatibility
   */
  getRelationshipTypes(): string[] {
    return this.getConnectionTypes();
  }

  /**
   * @deprecated No longer needed - pinboard data is saved via ProjectService.updatePinboard
   */
  private async saveRelationshipsToFile(projectPath: string, data: PinboardData): Promise<void> {
    // No-op: pinboard data is now saved via ProjectService
  }

  /**
   * Gets category color from project metadata
   */

  /**
   * Generates a consistent default position for new pins
   */
  private generateDefaultPosition(characterId: string): { x: number; y: number } {
    // Use character ID to generate a consistent but pseudo-random position
    let hash = 0;
    for (let i = 0; i < characterId.length; i++) {
      const char = characterId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Convert hash to position within a reasonable range
    const x = (Math.abs(hash) % 800) - 400; // Range: -400 to 400
    const y = (Math.abs(hash >> 16) % 600) - 300; // Range: -300 to 300

    return { x, y };
  }

  /**
   * Finds an unoccupied position for a new pin considering existing pins and grid size
   */
  findUnoccupiedPosition(gridSize: number = 100): { x: number; y: number } {
    const currentData = this.pinboardDataSubject.value;
    const occupiedPositions = new Set<string>();

    // Build a set of occupied grid positions (only if pins exist)
    if (currentData && currentData.nodes && currentData.nodes.length > 0) {
      currentData.nodes.forEach(node => {
        // Snap existing positions to grid
        const gridX = Math.round(node.position.x / gridSize) * gridSize;
        const gridY = Math.round(node.position.y / gridSize) * gridSize;
        occupiedPositions.add(`${gridX},${gridY}`);
      });
    }

    // Try to find an unoccupied position in a spiral pattern from origin
    let radius = 0;
    const maxRadius = 20; // Maximum search radius in grid cells

    while (radius <= maxRadius) {
      // Try positions in a spiral pattern at this radius
      for (let angle = 0; angle < 360; angle += 45) {
        const radians = (angle * Math.PI) / 180;
        const x = Math.round(Math.cos(radians) * radius) * gridSize;
        const y = Math.round(Math.sin(radians) * radius) * gridSize;
        const posKey = `${x},${y}`;

        if (!occupiedPositions.has(posKey)) {
          return { x, y };
        }
      }
      radius++;
    }

    // If all positions in the spiral are occupied (unlikely), generate a random position far away
    return {
      x: (Math.random() - 0.5) * 2000,
      y: (Math.random() - 0.5) * 2000
    };
  }

  /**
   * Adds a single pin to the pinboard at an unoccupied position
   */
  async addPin(character: any, gridSize: number = 100): Promise<void> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const currentData = this.pinboardDataSubject.value;

    // Ensure nodes array exists
    if (!currentData || !currentData.nodes) {
      console.error('Invalid pinboard data structure:', currentData);
      throw new Error('Pinboard data is not properly initialized');
    }

    // Check if pin already exists
    if (currentData.nodes.some(node => node.id === character.id)) {
      console.warn('Pin already exists for character:', character.name);
      return;
    }

    // Find an unoccupied position
    const position = this.findUnoccupiedPosition(gridSize);

    const newPin: PinboardPin = {
      id: character.id,
      name: character.name,
      position,
      category: character.category
    };

    const updatedData = {
      nodes: [...(currentData.nodes || []), newPin],
      edges: [...(currentData.edges || [])]
    };

    await this.projectService.updatePinboard(updatedData);
    this.pinboardDataSubject.next(updatedData);
  }

  /**
   * Removes a pin from the current pinboard (and its connections)
   */
  async removePin(characterId: string): Promise<void> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const currentData = this.pinboardDataSubject.value;

    // Remove the pin
    const updatedNodes = currentData.nodes.filter(node => node.id !== characterId);

    // Remove all edges involving this character
    const updatedEdges = currentData.edges.filter(edge =>
      edge.source !== characterId && edge.target !== characterId
    );

    const updatedData = {
      nodes: updatedNodes,
      edges: updatedEdges
    };

    await this.projectService.updatePinboard(updatedData);
    this.pinboardDataSubject.next(updatedData);
  }

  /**
   * @deprecated Use addPin() instead
   * Legacy method for backward compatibility
   */
  async addNode(character: any, gridSize: number = 100): Promise<void> {
    return this.addPin(character, gridSize);
  }

  /**
   * Debug method to log current pinboard state
   */
  debugLogPinboardState(): void {
    const currentData = this.pinboardDataSubject.value;
    console.log('Current pinboard state:', {
      pinCount: currentData.nodes.length,
      connectionCount: currentData.edges.length,
      pins: currentData.nodes.map(n => ({
        id: n.id,
        name: n.name,
        position: n.position
      }))
    });
  }

  /**
   * @deprecated Use debugLogPinboardState() instead
   * Legacy method for backward compatibility
   */
  debugLogGraphState(): void {
    this.debugLogPinboardState();
  }

}

