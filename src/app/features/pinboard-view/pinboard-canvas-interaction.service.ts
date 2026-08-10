import { Injectable } from '@angular/core';
import { PinboardNetworkService } from './pinboard-network.service';

export interface PinboardInteractionHandlers {
  onConnectionTargetSelected: (sourceId: string, targetId: string) => void;
  onDoubleClickNode: (nodeId: string) => void;
  onDoubleClickEdge: (edgeId: string) => void;
  onViewChanged: () => void;
}

@Injectable()
export class PinboardCanvasInteractionService {
  connectionMode = false;
  connectionSourceNode: string | null = null;
  plusIconPosition: { x: number; y: number } | null = null;
  selectedNodeForConnection: string | null = null;
  selectedNodes: string[] = [];
  hoveredNodeId: string | null = null;

  private containerElement: HTMLElement | null = null;
  private handlers: PinboardInteractionHandlers | null = null;

  constructor(private networkService: PinboardNetworkService) {}

  attach(container: HTMLElement, handlers: PinboardInteractionHandlers): void {
    this.containerElement = container;
    this.handlers = handlers;
    this.setupInteractionEvents();
  }

  detach(): void {
    this.containerElement = null;
    this.handlers = null;
    this.resetInteractionState();
  }

  resetInteractionState(): void {
    this.connectionMode = false;
    this.connectionSourceNode = null;
    this.selectedNodeForConnection = null;
    this.hoveredNodeId = null;
    this.plusIconPosition = null;
    this.selectedNodes = [];
    this.resetCursor();
  }

  exitConnectionMode(): void {
    this.connectionMode = false;
    this.connectionSourceNode = null;
    this.resetCursor();
  }

  clearPlusIconState(): void {
    this.selectedNodeForConnection = null;
    this.plusIconPosition = null;
  }

  onPlusIconClick(event: MouseEvent): void {
    event.stopPropagation();

    if (this.selectedNodeForConnection) {
      this.connectionMode = true;
      this.connectionSourceNode = this.selectedNodeForConnection;

      const canvas = this.containerElement?.querySelector('canvas');
      if (canvas) {
        canvas.style.cursor = 'crosshair';
      }
    }
  }

  updatePlusIconPosition(nodeId: string): void {
    const network = this.networkService.getNetwork();
    if (!network || !this.containerElement) {
      return;
    }

    const positions = network.getPositions([nodeId]);
    const nodePosition = positions[nodeId];
    if (!nodePosition) {
      return;
    }

    const canvas = this.containerElement.querySelector('canvas');
    if (!canvas) {
      return;
    }

    const container = this.containerElement.closest('.pinboard-container');
    if (!container) {
      return;
    }

    const canvasPos = network.canvasToDOM(nodePosition);
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = (container as HTMLElement).getBoundingClientRect();
    const canvasOffsetX = canvasRect.left - containerRect.left;
    const canvasOffsetY = canvasRect.top - containerRect.top;

    const nodeSize = 30;
    const plusIconSize = 32;
    const plusIconOffset = nodeSize / 2 + plusIconSize / 2 + 10;

    this.plusIconPosition = {
      x: canvasPos.x + plusIconOffset + canvasOffsetX,
      y: canvasPos.y + canvasOffsetY,
    };
  }

  getHoveredNodePosition(): { x: number; y: number } | null {
    const network = this.networkService.getNetwork();
    if (!this.hoveredNodeId || !network || !this.containerElement) {
      return null;
    }

    try {
      const positions = network.getPositions([this.hoveredNodeId]);
      const nodePosition = positions[this.hoveredNodeId];
      if (!nodePosition) {
        return null;
      }

      const canvas = this.containerElement.querySelector('canvas');
      if (!canvas) {
        return null;
      }

      const container = this.containerElement.closest('.pinboard-container');
      if (!container) {
        return null;
      }

      const canvasPos = network.canvasToDOM(nodePosition);
      const canvasRect = canvas.getBoundingClientRect();
      const containerRect = (container as HTMLElement).getBoundingClientRect();
      const canvasOffsetX = canvasRect.left - containerRect.left;
      const canvasOffsetY = canvasRect.top - containerRect.top;

      const nodeSize = 30;
      const deleteIconSize = 24;
      const deleteIconOffset = nodeSize / 2 + deleteIconSize / 2 + 5;

      return {
        x: canvasPos.x + deleteIconOffset + canvasOffsetX,
        y: canvasPos.y - deleteIconOffset + canvasOffsetY,
      };
    } catch {
      return null;
    }
  }

  handleNodeDragged(nodeIds: string[]): void {
    if (this.selectedNodeForConnection && nodeIds.includes(this.selectedNodeForConnection)) {
      this.updatePlusIconPosition(this.selectedNodeForConnection);
    }
    if (this.hoveredNodeId && nodeIds.includes(this.hoveredNodeId)) {
      this.handlers?.onViewChanged();
    }
  }

  handleViewChanged(): void {
    if (this.selectedNodeForConnection) {
      this.updatePlusIconPosition(this.selectedNodeForConnection);
    }
    this.handlers?.onViewChanged();
  }

  private setupInteractionEvents(): void {
    const network = this.networkService.getNetwork();
    if (!network) return;

    network.on('selectNode', (params) => {
      this.selectedNodes = params.nodes;

      if (this.connectionMode && this.connectionSourceNode && params.nodes.length > 0) {
        const targetNode = params.nodes[0];
        if (targetNode !== this.connectionSourceNode) {
          setTimeout(() => {
            this.handlers?.onConnectionTargetSelected(this.connectionSourceNode!, targetNode);
            this.exitConnectionMode();
          }, 0);
        } else {
          this.exitConnectionMode();
        }
      }
    });

    network.on('hoverNode', (params) => {
      if (!this.connectionMode && params.node) {
        this.selectedNodeForConnection = params.node;
        this.hoveredNodeId = params.node;
        setTimeout(() => {
          this.updatePlusIconPosition(params.node);
          this.handlers?.onViewChanged();
        }, 10);
      }
    });

    network.on('blurNode', () => {
      if (!this.connectionMode) {
        this.selectedNodeForConnection = null;
        this.hoveredNodeId = null;
        this.plusIconPosition = null;
      }
    });

    network.on('click', (params) => {
      if (this.connectionMode && params.nodes.length === 0 && params.edges.length === 0) {
        this.exitConnectionMode();
      }
    });

    network.on('doubleClick', (params) => {
      if (params.nodes.length > 0 && params.edges.length === 0) {
        this.handlers?.onDoubleClickNode(params.nodes[0]);
      } else if (params.edges.length > 0) {
        this.handlers?.onDoubleClickEdge(params.edges[0]);
      }
    });

    network.on('dragging', (params) => {
      if (params.nodes.length > 0) {
        this.handleNodeDragged(params.nodes);
      }
    });

    network.on('dragEnd', (params) => {
      if (params.nodes.length > 0) {
        if (this.selectedNodeForConnection && params.nodes.includes(this.selectedNodeForConnection)) {
          setTimeout(() => {
            this.updatePlusIconPosition(this.selectedNodeForConnection!);
          }, 50);
        }
        if (this.hoveredNodeId && params.nodes.includes(this.hoveredNodeId)) {
          this.handlers?.onViewChanged();
        }
      }
    });

    network.on('zoom', () => {
      this.handleViewChanged();
    });

    network.on('dragEnd', () => {
      if (this.selectedNodeForConnection) {
        setTimeout(() => {
          this.updatePlusIconPosition(this.selectedNodeForConnection!);
        }, 50);
      }
      if (this.hoveredNodeId) {
        this.handlers?.onViewChanged();
      }
    });
  }

  private resetCursor(): void {
    const canvas = this.containerElement?.querySelector('canvas');
    if (canvas) {
      canvas.style.cursor = 'default';
    }
  }
}
