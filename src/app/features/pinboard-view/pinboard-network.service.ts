import { Injectable } from '@angular/core';
import { DataSet, Edge, Network, Node, Options } from 'vis-network/standalone';
import { Character, PinboardData } from '../../core/interfaces';
import { PinboardService, ProjectService } from '../../core/services';

export interface PinboardViewStateSnapshot {
  zoomIndex: number;
  viewPosition: { x: number; y: number };
  showGrid: boolean;
  snapToGrid: boolean;
}

@Injectable()
export class PinboardNetworkService {
  readonly zoomLevels = [0.5, 1.0, 1.5, 2.0, 2.5];
  readonly gridSize = 100;

  currentZoomIndex = 1;
  showGrid = false;
  snapToGrid = true;
  networkInitialized = false;
  isEmpty = false;

  private network: Network | null = null;
  private nodes: DataSet<Node> = new DataSet([]);
  private edges: DataSet<Edge> = new DataSet([]);
  private containerElement: HTMLElement | null = null;
  private lastMousePosition: { x: number; y: number } | null = null;
  private middleClickPanCleanup: (() => void) | null = null;
  private wheelZoomCleanup: (() => void) | null = null;

  constructor(
    private pinboardService: PinboardService,
    private projectService: ProjectService
  ) {}

  getNetwork(): Network | null {
    return this.network;
  }

  getNodes(): DataSet<Node> {
    return this.nodes;
  }

  initialize(container: HTMLElement): void {
    this.containerElement = container;

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
        enabled: false,
        stabilization: false,
      },
      layout: {
        randomSeed: 42,
        improvedLayout: false,
        hierarchical: false,
      },
      interaction: {
        dragNodes: true,
        dragView: false,
        zoomView: false,
        selectConnectedEdges: false,
        multiselect: true,
        selectable: true,
        hover: true,
      },
      manipulation: {
        enabled: false,
      },
    };

    this.network = new Network(container, { nodes: this.nodes, edges: this.edges }, options);
    this.networkInitialized = true;
    this.isEmpty = this.nodes.length === 0;

    this.setupDiscreteZoom();
    this.setupMiddleClickPan();
    this.setupCoreNetworkEvents();
    this.setupGridDrawing();
  }

  destroy(): void {
    this.middleClickPanCleanup?.();
    this.middleClickPanCleanup = null;
    this.wheelZoomCleanup?.();
    this.wheelZoomCleanup = null;

    if (this.network) {
      this.network.destroy();
      this.network = null;
    }

    this.networkInitialized = false;
    this.containerElement = null;
  }

  async updateFromPinboardData(pinboardData: PinboardData, characters: Character[]): Promise<void> {
    if (!this.network) {
      console.warn('updatePinboard called but network is not initialized');
      return;
    }

    const visData = await this.pinboardService.getVisJsDataWithThumbnails(characters);

    const imagePromises = visData.nodes
      .filter(node => node.image)
      .map(node => {
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = node.image!;
        });
      });

    await Promise.all(imagePromises);

    this.nodes.clear();
    this.nodes.add(visData.nodes);
    this.isEmpty = visData.nodes.length === 0;

    const edgeIds = new Set(visData.edges.map(e => e.id));
    const existingEdgeIds = new Set(this.edges.getIds() as string[]);

    existingEdgeIds.forEach(id => {
      if (!edgeIds.has(id)) {
        this.edges.remove(id);
      }
    });

    visData.edges.forEach(edge => {
      if (existingEdgeIds.has(edge.id)) {
        this.edges.remove(edge.id);
      }
      this.edges.add(edge);
    });

    this.network.redraw();
    this.enforcePinPositions(pinboardData);

    setTimeout(() => {
      this.enforcePinPositions(pinboardData);
      this.network?.redraw();
    }, 50);

    setTimeout(() => {
      this.network?.redraw();
    }, 200);
  }

  enforcePinPositions(pinboardData: PinboardData): void {
    if (!this.network) return;

    for (const node of pinboardData.nodes) {
      const existingNode = this.nodes.get(node.id);
      if (existingNode) {
        try {
          this.nodes.update({
            id: node.id,
            x: node.position.x,
            y: node.position.y,
          });
          this.network.moveNode(node.id, node.position.x, node.position.y);
        } catch (error) {
          console.warn(`Failed to move node ${node.id}:`, error);
        }
      }
    }

    this.network.setOptions({ physics: { enabled: false } });
  }

  zoomIn(mousePos?: { x: number; y: number }): void {
    if (this.network && this.currentZoomIndex < this.zoomLevels.length - 1) {
      this.currentZoomIndex++;
      this.applyZoom(mousePos);
    }
  }

  zoomOut(mousePos?: { x: number; y: number }): void {
    if (this.network && this.currentZoomIndex > 0) {
      this.currentZoomIndex--;
      this.applyZoom(mousePos);
    }
  }

  getCurrentZoomLevel(): string {
    return `${(this.zoomLevels[this.currentZoomIndex] * 100).toFixed(0)}%`;
  }

  resetView(): void {
    this.network?.fit();
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid;
    this.redrawGrid();
    this.saveViewState();
  }

  toggleSnapToGrid(): void {
    this.snapToGrid = !this.snapToGrid;
    this.saveViewState();
  }

  saveViewState(): void {
    if (!this.network) return;

    const viewPosition = this.network.getViewPosition();
    const state: PinboardViewStateSnapshot = {
      zoomIndex: this.currentZoomIndex,
      viewPosition: { x: viewPosition.x, y: viewPosition.y },
      showGrid: this.showGrid,
      snapToGrid: this.snapToGrid,
    };

    this.projectService.savePinboardViewState(state).catch((error) => {
      console.warn('Failed to save pinboard view state:', error);
    });
  }

  async saveViewStateForPinboard(pinboardId: string): Promise<void> {
    if (!this.network) return;

    const viewPosition = this.network.getViewPosition();
    const state: PinboardViewStateSnapshot = {
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

  restoreViewState(): void {
    if (!this.network) return;

    const state = this.projectService.getPinboardViewState();
    if (!state) return;

    if (state.zoomIndex >= 0 && state.zoomIndex < this.zoomLevels.length) {
      this.currentZoomIndex = state.zoomIndex;
    }

    if (state.showGrid !== undefined) {
      this.showGrid = state.showGrid;
    }
    if (state.snapToGrid !== undefined) {
      this.snapToGrid = state.snapToGrid;
    }

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
    }, 500);
  }

  redrawGrid(): void {
    this.network?.redraw();
  }

  constrainView(): void {
    if (!this.network || !this.containerElement) return;

    const positions = this.network.getPositions();
    const nodeIds = Object.keys(positions);
    if (nodeIds.length === 0) return;

    const canvas = this.containerElement.querySelector('canvas');
    if (!canvas) return;

    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    const scale = this.network.getScale();
    const nodeSize = 20 * scale;
    const labelPadding = 80;
    const margin = nodeSize + labelPadding;

    let hasVisibleNode = false;
    for (const nodeId of nodeIds) {
      const canvasPos = this.network.canvasToDOM(positions[nodeId]);
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

    if (!hasVisibleNode) {
      const viewPosition = this.network.getViewPosition();
      let closestNode: string | null = null;
      let minDistance = Infinity;

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

  unselectAll(): void {
    this.network?.unselectAll();
  }

  private applyZoom(mousePos?: { x: number; y: number }): void {
    if (!this.network) return;

    const scale = this.zoomLevels[this.currentZoomIndex];

    if (mousePos) {
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
      this.network.moveTo({
        scale,
        animation: {
          duration: 200,
          easingFunction: 'easeInOutQuad',
        },
      });
    }

    setTimeout(() => {
      this.constrainView();
      this.saveViewState();
    }, 250);
  }

  private setupDiscreteZoom(): void {
    if (!this.network || !this.containerElement) return;

    const canvas = this.containerElement.querySelector('canvas');
    if (!canvas) return;

    const onMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.lastMousePosition = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mousePos = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      if (event.deltaY < 0) {
        this.zoomIn(mousePos);
      } else {
        this.zoomOut(mousePos);
      }
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    this.wheelZoomCleanup = () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
    };
  }

  private setupMiddleClickPan(): void {
    if (!this.network || !this.containerElement) return;

    const canvas = this.containerElement.querySelector('canvas');
    if (!canvas) return;

    let isPanning = false;
    let startPos = { x: 0, y: 0 };
    let startViewPos = { x: 0, y: 0 };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
        isPanning = true;
        startPos = { x: event.clientX, y: event.clientY };
        if (this.network) {
          startViewPos = this.network.getViewPosition();
        }
        canvas.style.cursor = 'grabbing';
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      if (isPanning && this.network) {
        event.preventDefault();

        const dx = event.clientX - startPos.x;
        const dy = event.clientY - startPos.y;
        const scale = this.network.getScale();

        this.network.moveTo({
          position: {
            x: startViewPos.x - dx / scale,
            y: startViewPos.y - dy / scale,
          },
          scale,
          animation: false,
        });
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 1 && isPanning) {
        isPanning = false;
        canvas.style.cursor = 'default';

        setTimeout(() => {
          this.saveViewState();
          this.constrainView();
        }, 100);
      }
    };

    const onContextMenu = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);

    this.middleClickPanCleanup = () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }

  private setupCoreNetworkEvents(): void {
    if (!this.network) return;

    this.network.on('dragStart', (params) => {
      if (params.nodes.length > 0) {
        this.network!.setOptions({ physics: { enabled: false } });
      }
    });

    this.network.on('dragging', (params) => {
      if (params.nodes.length > 0) {
        const positions = this.network!.getPositions(params.nodes);
        const draggedNodeId = params.nodes[0];
        let targetPos = positions[draggedNodeId];

        if (this.snapToGrid) {
          targetPos = {
            x: Math.round(targetPos.x / this.gridSize) * this.gridSize,
            y: Math.round(targetPos.y / this.gridSize) * this.gridSize,
          };
        }

        const allPositions = this.network!.getPositions();

        for (const [nodeId, nodePos] of Object.entries(allPositions)) {
          if (nodeId !== draggedNodeId) {
            if (Math.abs(nodePos.x - targetPos.x) < 1 && Math.abs(nodePos.y - targetPos.y) < 1) {
              return;
            }
          }
        }

        this.network!.moveNode(draggedNodeId, targetPos.x, targetPos.y);
      }
    });

    this.network.on('dragEnd', (params) => {
      if (params.nodes.length > 0) {
        const positions = this.network!.getPositions(params.nodes);
        const allPositions = this.network!.getPositions();

        if (this.snapToGrid) {
          const snappedPositions: { [key: string]: { x: number; y: number } } = {};

          Object.keys(positions).forEach((nodeId) => {
            const pos = positions[nodeId];
            let snappedPos = {
              x: Math.round(pos.x / this.gridSize) * this.gridSize,
              y: Math.round(pos.y / this.gridSize) * this.gridSize,
            };

            for (const [otherId, otherPos] of Object.entries(allPositions)) {
              if (otherId !== nodeId) {
                if (Math.abs(otherPos.x - snappedPos.x) < 1 && Math.abs(otherPos.y - snappedPos.y) < 1) {
                  snappedPos = pos;
                  break;
                }
              }
            }

            snappedPositions[nodeId] = snappedPos;
          });

          Object.keys(snappedPositions).forEach((nodeId) => {
            this.network!.moveNode(nodeId, snappedPositions[nodeId].x, snappedPositions[nodeId].y);
          });

          Object.keys(snappedPositions).forEach((nodeId) => {
            this.pinboardService.updatePinPosition(nodeId, snappedPositions[nodeId]);
          });
        } else {
          Object.keys(positions).forEach((nodeId) => {
            const finalPos = positions[nodeId];

            for (const [otherId, otherPos] of Object.entries(allPositions)) {
              if (otherId !== nodeId) {
                if (Math.abs(otherPos.x - finalPos.x) < 1 && Math.abs(otherPos.y - finalPos.y) < 1) {
                  return;
                }
              }
            }

            this.pinboardService.updatePinPosition(nodeId, finalPos);
          });
        }
      }

      setTimeout(() => this.constrainView(), 50);
      setTimeout(() => this.saveViewState(), 100);
      setTimeout(() => this.redrawGrid(), 50);
    });

    this.network.on('zoom', () => {
      this.redrawGrid();
      this.constrainView();
    });

    let dragTimeout: ReturnType<typeof setTimeout> | null = null;
    this.network.on('dragging', () => {
      if (dragTimeout) clearTimeout(dragTimeout);
      dragTimeout = setTimeout(() => {
        this.constrainView();
      }, 100);
    });

    this.network.on('stabilizationIterationsDone', () => {
      this.network!.setOptions({ physics: { enabled: false } });
    });
  }

  private setupGridDrawing(): void {
    if (!this.network) return;

    this.network.on('beforeDrawing', (ctx) => {
      if (this.showGrid) {
        this.drawGridOnCanvas(ctx);
      }
    });
  }

  private drawGridOnCanvas(ctx: CanvasRenderingContext2D): void {
    if (!this.network || !this.containerElement) return;

    const scale = this.network.getScale();
    const viewPosition = this.network.getViewPosition();
    const canvas = this.containerElement.querySelector('canvas');
    if (!canvas) return;

    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    const gridScreenSize = this.gridSize * scale;

    if (gridScreenSize < 10) {
      return;
    }

    const halfWidth = canvasWidth / (2 * scale);
    const halfHeight = canvasHeight / (2 * scale);

    const left = viewPosition.x - halfWidth;
    const right = viewPosition.x + halfWidth;
    const top = viewPosition.y - halfHeight;
    const bottom = viewPosition.y + halfHeight;

    const startX = Math.floor(left / this.gridSize) * this.gridSize;
    const endX = Math.ceil(right / this.gridSize) * this.gridSize;
    const startY = Math.floor(top / this.gridSize) * this.gridSize;
    const endY = Math.ceil(bottom / this.gridSize) * this.gridSize;

    ctx.strokeStyle = 'rgba(45, 55, 72, 0.5)';
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([]);
    ctx.beginPath();

    for (let x = startX; x <= endX; x += this.gridSize) {
      ctx.moveTo(x, startY - this.gridSize);
      ctx.lineTo(x, endY + this.gridSize);
    }

    for (let y = startY; y <= endY; y += this.gridSize) {
      ctx.moveTo(startX - this.gridSize, y);
      ctx.lineTo(endX + this.gridSize, y);
    }

    ctx.stroke();
  }
}
