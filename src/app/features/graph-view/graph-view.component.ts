import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, Subscription } from 'rxjs';
import { GraphData, Character } from '../../core/interfaces';
import { RelationshipService, CharacterService } from '../../core/services';

@Component({
  selector: 'app-graph-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './graph-view.component.html',
  styleUrls: ['./graph-view.component.scss']
})
export class GraphViewComponent implements OnInit, OnDestroy {
  @ViewChild('graphContainer', { static: true }) graphContainer!: ElementRef;
  
  graphData$: Observable<GraphData>;
  characters$: Observable<Character[]>;
  
  private subscriptions = new Subscription();
  private network: any = null;

  constructor(
    private relationshipService: RelationshipService,
    private characterService: CharacterService
  ) {
    this.graphData$ = this.relationshipService.getGraphData();
    this.characters$ = this.characterService.getCharacters();
  }

  ngOnInit(): void {
    this.initializeGraph();
    this.subscribeToData();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    if (this.network) {
      this.network.destroy();
    }
  }

  private initializeGraph(): void {
    // TODO: Initialize vis.js network
    console.log('Graph initialization - vis.js integration pending');
    
    // Placeholder for vis.js network initialization
    // const container = this.graphContainer.nativeElement;
    // const data = { nodes: [], edges: [] };
    // const options = {};
    // this.network = new Network(container, data, options);
  }

  private subscribeToData(): void {
    // Subscribe to character changes to sync nodes
    this.subscriptions.add(
      this.characters$.subscribe(characters => {
        this.relationshipService.syncNodesWithCharacters(characters);
      })
    );

    // Subscribe to graph data changes
    this.subscriptions.add(
      this.graphData$.subscribe(graphData => {
        this.updateGraph(graphData);
      })
    );
  }

  private updateGraph(graphData: GraphData): void {
    // TODO: Update vis.js network with new data
    console.log('Updating graph with data:', graphData);
    
    // if (this.network) {
    //   this.network.setData({
    //     nodes: graphData.nodes,
    //     edges: graphData.edges
    //   });
    // }
  }

  onCreateRelationship(): void {
    // TODO: Implement relationship creation dialog
    console.log('Create relationship dialog - not yet implemented');
  }

  onLayoutNodes(): void {
    // TODO: Implement automatic layout
    console.log('Auto layout - not yet implemented');
  }

  onResetView(): void {
    // TODO: Implement view reset
    console.log('Reset view - not yet implemented');
  }
}