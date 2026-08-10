import { Injectable } from '@angular/core';
import {
  Pinboard,
  PinboardConnection,
  PinboardPin,
  PinboardViewState,
  Project,
} from '../interfaces/project.interface';
import { generateId } from '../utils/id.utils';
import { pathJoin } from '../utils/path.utils';
import { assertIpcSuccess } from '../utils/ipc.utils';
import { ENSEMBLE_JSON_FILE } from '../constants/project.constants';
import { ElectronService } from './electron.service';

type PinboardData = { nodes: PinboardPin[]; edges: PinboardConnection[] };

@Injectable({ providedIn: 'root' })
export class PinboardStoreService {
  constructor(private electronService: ElectronService) {}

  getCurrent(project: Project): Pinboard | null {
    const pinboards = project.metadata.pinboards || [];
    const currentId = project.metadata.lastSession?.lastPinboardId;
    return pinboards.find((pinboard) => pinboard.id === currentId) || pinboards[0] || null;
  }

  async saveViewState(project: Project, state: PinboardViewState, pinboardId?: string): Promise<void> {
    const target = pinboardId
      ? (project.metadata.pinboards || []).find((pinboard) => pinboard.id === pinboardId)
      : this.getCurrent(project);
    if (target) {
      project.metadata.pinboards = (project.metadata.pinboards || []).map((pinboard) =>
        pinboard.id === target.id
          ? { ...pinboard, viewState: state, updatedAt: new Date().toISOString() }
          : pinboard
      );
    } else {
      project.metadata.settings.pinboardView = state;
    }
    await this.persist(project);
  }

  async setCurrent(project: Project, id: string): Promise<void> {
    if (!(project.metadata.pinboards || []).some((pinboard) => pinboard.id === id)) {
      throw new Error(`Pinboard with id ${id} not found`);
    }
    this.ensureLastSession(project.metadata).lastPinboardId = id;
    await this.persist(project);
  }

  async create(project: Project, name: string, duplicateFromId?: string): Promise<Pinboard> {
    const pinboards = [...(project.metadata.pinboards || [])];
    if (pinboards.some((pinboard) => pinboard.name === name)) {
      throw new Error(`A pinboard named "${name}" already exists`);
    }
    const created: Pinboard = {
      id: generateId(), name, nodes: [], edges: [], createdAt: new Date().toISOString(),
    };
    const source = duplicateFromId && pinboards.find((pinboard) => pinboard.id === duplicateFromId);
    if (source) {
      created.nodes = structuredClone(source.nodes);
      created.edges = structuredClone(source.edges);
      if (source.viewState) created.viewState = structuredClone(source.viewState);
    }
    pinboards.push(created);
    project.metadata.pinboards = pinboards;
    if (pinboards.length === 1) this.ensureLastSession(project.metadata).lastPinboardId = created.id;
    await this.persist(project);
    return created;
  }

  async updateData(project: Project, id: string, data: PinboardData): Promise<void> {
    this.update(project, id, { nodes: data.nodes, edges: data.edges });
    await this.persist(project);
  }

  async updateName(project: Project, id: string, name: string): Promise<void> {
    const pinboards = project.metadata.pinboards || [];
    if (pinboards.some((pinboard) => pinboard.name === name && pinboard.id !== id)) {
      throw new Error(`A pinboard named "${name}" already exists`);
    }
    this.update(project, id, { name });
    await this.persist(project);
  }

  async delete(project: Project, id: string): Promise<void> {
    const pinboards = project.metadata.pinboards || [];
    if (!pinboards.some((pinboard) => pinboard.id === id)) {
      throw new Error(`Pinboard with id ${id} not found`);
    }
    project.metadata.pinboards = pinboards.filter((pinboard) => pinboard.id !== id);
    const session = project.metadata.lastSession;
    if (session?.lastPinboardId === id) {
      session.lastPinboardId = project.metadata.pinboards[0]?.id;
    }
    await this.persist(project);
  }

  private update(project: Project, id: string, changes: Partial<Pinboard>): void {
    let found = false;
    project.metadata.pinboards = (project.metadata.pinboards || []).map((pinboard) => {
      if (pinboard.id !== id) return pinboard;
      found = true;
      return { ...pinboard, ...changes, updatedAt: new Date().toISOString() };
    });
    if (!found) throw new Error(`Pinboard with id ${id} not found`);
  }

  private ensureLastSession(metadata: Project['metadata']): NonNullable<Project['metadata']['lastSession']> {
    metadata.lastSession ||= {};
    return metadata.lastSession;
  }

  private async persist(project: Project): Promise<void> {
    const path = pathJoin(project.path, ENSEMBLE_JSON_FILE);
    assertIpcSuccess(
      await this.electronService.writeFileAtomic(path, JSON.stringify(project.metadata, null, 2)),
      'Save pinboard metadata'
    );
  }
}
