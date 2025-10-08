import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Relationship, GraphNode, GraphData } from '../interfaces/relationship.interface';

@Injectable({
  providedIn: 'root'
})
export class RelationshipService {
  private graphDataSubject = new BehaviorSubject<GraphData>({ nodes: [], edges: [] });
  public graphData$ = this.graphDataSubject.asObservable();

  constructor() {}

  getGraphData(): Observable<GraphData> {
    return this.graphData$;
  }

  async loadRelationships(projectPath: string): Promise<void> {
    // TODO: Implement relationship loading from file system
    console.log('Loading relationships from:', projectPath);
  }

  async createRelationship(relationship: Omit<Relationship, 'id'>): Promise<Relationship> {
    // TODO: Implement relationship creation
    const newRelationship: Relationship = {
      id: this.generateId(),
      ...relationship
    };
    
    const currentData = this.graphDataSubject.value;
    const updatedData = {
      ...currentData,
      edges: [...currentData.edges, newRelationship]
    };
    
    this.graphDataSubject.next(updatedData);
    return newRelationship;
  }

  async updateRelationship(id: string, updates: Partial<Relationship>): Promise<Relationship | null> {
    // TODO: Implement relationship update
    const currentData = this.graphDataSubject.value;
    const edgeIndex = currentData.edges.findIndex(edge => edge.id === id);
    
    if (edgeIndex === -1) return null;
    
    const updatedEdge = { ...currentData.edges[edgeIndex], ...updates };
    const updatedEdges = [...currentData.edges];
    updatedEdges[edgeIndex] = updatedEdge;
    
    this.graphDataSubject.next({
      ...currentData,
      edges: updatedEdges
    });
    
    return updatedEdge;
  }

  async deleteRelationship(id: string): Promise<boolean> {
    // TODO: Implement relationship deletion
    const currentData = this.graphDataSubject.value;
    const filteredEdges = currentData.edges.filter(edge => edge.id !== id);
    
    if (filteredEdges.length === currentData.edges.length) return false;
    
    this.graphDataSubject.next({
      ...currentData,
      edges: filteredEdges
    });
    
    return true;
  }

  async updateNodePosition(nodeId: string, position: { x: number; y: number }): Promise<void> {
    // TODO: Implement node position update
    const currentData = this.graphDataSubject.value;
    const nodeIndex = currentData.nodes.findIndex(node => node.id === nodeId);
    
    if (nodeIndex === -1) return;
    
    const updatedNodes = [...currentData.nodes];
    updatedNodes[nodeIndex] = { ...updatedNodes[nodeIndex], position };
    
    this.graphDataSubject.next({
      ...currentData,
      nodes: updatedNodes
    });
  }

  async syncNodesWithCharacters(characters: any[]): Promise<void> {
    // TODO: Implement node synchronization with character data
    const currentData = this.graphDataSubject.value;
    const existingNodes = new Map(currentData.nodes.map(node => [node.id, node]));
    
    const updatedNodes: GraphNode[] = characters.map(character => {
      const existingNode = existingNodes.get(character.id);
      return {
        id: character.id,
        name: character.name,
        position: existingNode?.position || { x: Math.random() * 400, y: Math.random() * 400 },
        category: character.category,
        color: this.getCategoryColor(character.category)
      };
    });
    
    this.graphDataSubject.next({
      ...currentData,
      nodes: updatedNodes
    });
  }

  private getCategoryColor(category: string): string {
    // TODO: Get color from project metadata
    const colors: { [key: string]: string } = {
      'main-character': '#3498db',
      'supporting': '#2ecc71',
      'antagonist': '#e74c3c'
    };
    return colors[category] || '#95a5a6';
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}