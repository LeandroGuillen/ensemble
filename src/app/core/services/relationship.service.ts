import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Relationship, GraphNode, GraphData } from '../interfaces/relationship.interface';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';

@Injectable({
  providedIn: 'root'
})
export class RelationshipService {
  private graphDataSubject = new BehaviorSubject<GraphData>({ nodes: [], edges: [] });
  public graphData$ = this.graphDataSubject.asObservable();
  private currentProjectPath: string | null = null;
  private relationshipsLoaded = false;

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService
  ) {
    // Subscribe to project changes to load relationships
    this.projectService.currentProject$.subscribe(project => {
      if (project && project.path !== this.currentProjectPath) {
        this.currentProjectPath = project.path;
        this.loadRelationshipsFromProject(project);
      } else if (!project) {
        this.currentProjectPath = null;
        this.graphDataSubject.next({ nodes: [], edges: [] });
      }
    });
  }

  /**
   * Loads relationships from the project metadata
   */
  private loadRelationshipsFromProject(project: any): void {
    const relationships = this.projectService.getRelationships();
    this.relationshipsLoaded = true;
    this.graphDataSubject.next(relationships);
  }

  getGraphData(): Observable<GraphData> {
    return this.graphData$;
  }

  /**
   * @deprecated This method is no longer used - relationships are loaded from ensemble.json via ProjectService
   */
  async loadRelationships(projectPath: string): Promise<void> {
    // No-op: relationships are now loaded from project metadata
  }

  /**
   * Creates a new relationship and saves to ensemble.json
   */
  async createRelationship(relationship: Omit<Relationship, 'id'>): Promise<Relationship> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const newRelationship: Relationship = {
      id: this.generateId(),
      ...relationship
    };

    const currentData = this.graphDataSubject.value;
    const updatedData = {
      ...currentData,
      edges: [...currentData.edges, newRelationship]
    };

    await this.projectService.updateRelationships(updatedData);
    this.graphDataSubject.next(updatedData);

    return newRelationship;
  }

  /**
   * Updates an existing relationship and saves to ensemble.json
   */
  async updateRelationship(id: string, updates: Partial<Relationship>): Promise<Relationship | null> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const currentData = this.graphDataSubject.value;
    const edgeIndex = currentData.edges.findIndex(edge => edge.id === id);

    if (edgeIndex === -1) return null;

    const updatedEdge = { ...currentData.edges[edgeIndex], ...updates };
    const updatedEdges = [...currentData.edges];
    updatedEdges[edgeIndex] = updatedEdge;

    const updatedData = {
      ...currentData,
      edges: updatedEdges
    };

    await this.projectService.updateRelationships(updatedData);
    this.graphDataSubject.next(updatedData);

    return updatedEdge;
  }

  /**
   * Deletes a relationship and saves to ensemble.json
   */
  async deleteRelationship(id: string): Promise<boolean> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const currentData = this.graphDataSubject.value;
    const filteredEdges = currentData.edges.filter(edge => edge.id !== id);

    if (filteredEdges.length === currentData.edges.length) return false;

    const updatedData = {
      ...currentData,
      edges: filteredEdges
    };

    await this.projectService.updateRelationships(updatedData);
    this.graphDataSubject.next(updatedData);

    return true;
  }

  /**
   * Updates node position and saves to ensemble.json
   */
  async updateNodePosition(nodeId: string, position: { x: number; y: number }): Promise<void> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const currentData = this.graphDataSubject.value;
    const nodeIndex = currentData.nodes.findIndex(node => node.id === nodeId);

    if (nodeIndex === -1) {
      console.warn('Attempted to update position for non-existent node:', nodeId);
      return;
    }

    console.log('Updating node position:', { nodeId, position });

    const updatedNodes = [...currentData.nodes];
    updatedNodes[nodeIndex] = { ...updatedNodes[nodeIndex], position };

    const updatedData = {
      ...currentData,
      nodes: updatedNodes
    };

    await this.projectService.updateRelationships(updatedData);
    this.graphDataSubject.next(updatedData);
  }

  /**
   * Ensures nodes exist for all characters without overwriting existing positions
   */
  async ensureNodesForCharacters(characters: any[]): Promise<void> {
    console.log('=== ENSURE NODES FOR CHARACTERS ===');
    console.log('Input characters:', characters.map(c => c.name));
    console.log('Relationships loaded:', this.relationshipsLoaded);
    
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    // Don't sync nodes until relationships have been loaded
    if (!this.relationshipsLoaded) {
      console.log('Relationships not loaded yet, skipping node sync');
      return;
    }

    const currentData = this.graphDataSubject.value;
    console.log('Current graph data before ensure:', {
      nodeCount: currentData.nodes.length,
      nodes: currentData.nodes.map(n => ({ id: n.id, name: n.name, position: n.position }))
    });
    
    const existingNodes = new Map(currentData.nodes.map(node => [node.id, node]));
    const characterIds = new Set(characters.map(char => char.id));
    
    let hasChanges = false;
    
    // Start with existing nodes
    const updatedNodes: GraphNode[] = [...currentData.nodes];
    
    // Add nodes for new characters
    for (const character of characters) {
      if (!existingNodes.has(character.id)) {
        const newPosition = this.generateDefaultPosition(character.id);
        console.log('Adding new node for character:', character.name, 'at position:', newPosition);
        updatedNodes.push({
          id: character.id,
          name: character.name,
          position: newPosition,
          category: character.category,
          color: this.getCategoryColor(character.category)
        });
        hasChanges = true;
      } else {
        // Update existing node properties (but preserve position)
        const existingNode = existingNodes.get(character.id)!;
        const nodeIndex = updatedNodes.findIndex(n => n.id === character.id);
        if (nodeIndex !== -1) {
          const updatedNode = {
            ...existingNode,
            name: character.name,
            category: character.category,
            color: this.getCategoryColor(character.category)
            // Keep existing position
          };
          
          console.log(`Updating existing node ${character.name}:`, {
            oldPosition: existingNode.position,
            newPosition: updatedNode.position,
            positionChanged: JSON.stringify(existingNode.position) !== JSON.stringify(updatedNode.position)
          });
          
          // Check if anything actually changed
          if (JSON.stringify(updatedNode) !== JSON.stringify(existingNode)) {
            updatedNodes[nodeIndex] = updatedNode;
            hasChanges = true;
          }
        }
      }
    }
    
    // Remove nodes for deleted characters
    const filteredNodes = updatedNodes.filter(node => characterIds.has(node.id));
    if (filteredNodes.length !== updatedNodes.length) {
      hasChanges = true;
      console.log('Removing nodes for deleted characters');
    }

    // Remove relationships for deleted characters (referential integrity)
    const validEdges = currentData.edges.filter(edge => 
      characterIds.has(edge.source) && characterIds.has(edge.target)
    );

    console.log('Ensure nodes result:', {
      hasChanges,
      finalNodeCount: filteredNodes.length,
      finalNodes: filteredNodes.map(n => ({ id: n.id, name: n.name, position: n.position }))
    });

    if (hasChanges || validEdges.length !== currentData.edges.length) {
      const updatedData = {
        nodes: filteredNodes,
        edges: validEdges
      };

      console.log('Saving updated data to ensemble.json...');
      await this.projectService.updateRelationships(updatedData);
      this.graphDataSubject.next(updatedData);
    } else {
      console.log('No changes detected, skipping save');
    }
  }

  /**
   * @deprecated Use ensureNodesForCharacters instead
   * Synchronizes nodes with character data and maintains referential integrity
   */
  async syncNodesWithCharacters(characters: any[]): Promise<void> {
    return this.ensureNodesForCharacters(characters);
  }

  /**
   * Removes all relationships for a specific character (for referential integrity)
   */
  async removeCharacterRelationships(characterId: string): Promise<void> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const currentData = this.graphDataSubject.value;

    // Remove the node
    const updatedNodes = currentData.nodes.filter(node => node.id !== characterId);

    // Remove all edges involving this character
    const updatedEdges = currentData.edges.filter(edge =>
      edge.source !== characterId && edge.target !== characterId
    );

    const updatedData = {
      nodes: updatedNodes,
      edges: updatedEdges
    };

    await this.projectService.updateRelationships(updatedData);
    this.graphDataSubject.next(updatedData);
  }

  /**
   * Converts graph data to vis.js Network format
   */
  getVisJsData(): { nodes: any[], edges: any[] } {
    const currentData = this.graphDataSubject.value;
    
    const visNodes = currentData.nodes.map(node => {
      const baseNode: any = {
        id: node.id,
        label: node.name,
        x: node.position.x,
        y: node.position.y,
        font: {
          color: '#343434',
          size: 14,
          face: 'Arial'
        },
        borderWidth: 2,
        borderWidthSelected: 3,
        shape: 'dot',
        size: 25,
        color: {
          background: node.color || '#97C2FC',
          border: '#2B7CE9'
        }
      };

      return baseNode;
    });

    const visEdges = currentData.edges.map(edge => ({
      id: edge.id,
      from: edge.source,
      to: edge.target,
      label: edge.label,
      color: {
        color: edge.color || '#848484'
      },
      arrows: edge.bidirectional ? 'to, from' : 'to',
      font: {
        color: '#343434',
        size: 12
      }
    }));

    return { nodes: visNodes, edges: visEdges };
  }

  /**
   * Gets vis.js data with thumbnails loaded dynamically from character data
   */
  async getVisJsDataWithThumbnails(characters: any[]): Promise<{ nodes: any[], edges: any[] }> {
    const currentData = this.graphDataSubject.value;
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
          strokeColor: '#0a0e1a',
          bold: '500'
        },

        labelHighlightBold: false,
        fixed: false, // Allow manual positioning
        physics: false // Disable physics for this node
      };

      // Load thumbnail dynamically if character has one
      if (character?.thumbnail && this.currentProjectPath) {
        try {
          const thumbnailPath = await this.electronService.pathJoin(this.currentProjectPath, 'thumbnails', character.thumbnail);
          const thumbnailDataUrl = await this.electronService.getImageAsDataUrl(thumbnailPath);
          
          if (thumbnailDataUrl) {
            baseNode.shape = 'circularImage';
            baseNode.image = thumbnailDataUrl;
            baseNode.size = 30;
            baseNode.color = {
              border: node.color || '#2B7CE9',
              background: '#ffffff'
            };
          } else {
            // Fallback to colored circle
            baseNode.shape = 'dot';
            baseNode.size = 25;
            baseNode.color = {
              background: node.color || '#97C2FC',
              border: '#2B7CE9'
            };
          }
        } catch (error) {
          console.warn(`Failed to load thumbnail for character ${node.id}:`, error);
          // Fallback to colored circle
          baseNode.shape = 'dot';
          baseNode.size = 25;
          baseNode.color = {
            background: node.color || '#97C2FC',
            border: '#2B7CE9'
          };
        }
      } else {
        // No thumbnail, use colored circle
        baseNode.shape = 'dot';
        baseNode.size = 25;
        baseNode.color = {
          background: node.color || '#97C2FC',
          border: '#2B7CE9'
        };
      }

      return baseNode;
    }));

    const visEdges = currentData.edges.map(edge => ({
      id: edge.id,
      from: edge.source,
      to: edge.target,
      label: edge.label,
      color: {
        color: edge.color || '#848484'
      },
      arrows: edge.bidirectional ? 'to, from' : 'to',
      font: {
        color: '#343434',
        size: 12
      }
    }));

    return { nodes: visNodes, edges: visEdges };
  }

  /**
   * Updates graph data from vis.js Network positions
   */
  async updateFromVisJsPositions(positions: { [nodeId: string]: { x: number; y: number } }): Promise<void> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const currentData = this.graphDataSubject.value;
    const updatedNodes = currentData.nodes.map(node => ({
      ...node,
      position: positions[node.id] || node.position
    }));

    const updatedData = {
      ...currentData,
      nodes: updatedNodes
    };

    await this.projectService.updateRelationships(updatedData);
    this.graphDataSubject.next(updatedData);
  }

  /**
   * Gets available relationship types
   */
  getRelationshipTypes(): string[] {
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
   * @deprecated No longer needed - relationships are saved via ProjectService.updateRelationships
   */
  private async saveRelationshipsToFile(projectPath: string, data: GraphData): Promise<void> {
    // No-op: relationships are now saved via ProjectService
  }

  /**
   * Gets category color from project metadata
   */
  private getCategoryColor(category: string): string {
    const project = this.projectService.getCurrentProject();
    if (project) {
      const categoryData = project.metadata.categories.find(cat => cat.id === category);
      if (categoryData) {
        return categoryData.color;
      }
    }
    
    // Fallback colors
    const colors: { [key: string]: string } = {
      'main-character': '#3498db',
      'supporting': '#2ecc71',
      'antagonist': '#e74c3c',
      'minor': '#9b59b6'
    };
    return colors[category] || '#95a5a6';
  }

  /**
   * Generates a consistent default position for new nodes
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
   * Debug method to log current graph state
   */
  debugLogGraphState(): void {
    const currentData = this.graphDataSubject.value;
    console.log('Current graph state:', {
      nodeCount: currentData.nodes.length,
      edgeCount: currentData.edges.length,
      nodes: currentData.nodes.map(n => ({
        id: n.id,
        name: n.name,
        position: n.position
      }))
    });
  }

  /**
   * Generates a unique ID for relationships
   */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }
}