import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { ConnectionEditDialogComponent } from './connection-edit-dialog.component';
import { CastEditorSessionService } from '../../../../core/services/cast-editor-session.service';
import { PinboardService } from '../../../../core/services/pinboard.service';
import { ProjectService } from '../../../../core/services/project.service';
import { CharacterService } from '../../../../core/services/character.service';
import { CastService } from '../../../../core/services/cast.service';
import { LoggingService } from '../../../../core/services/logging.service';
import { createEmptyConnectionForm } from '../../pinboard-connection-form';

describe('Connection arrow preview', () => {
  for (const arrowFrom of [false, true]) {
    for (const arrowTo of [false, true]) {
      it(`matches the graph endpoints with source=${arrowFrom}, target=${arrowTo}`, async () => {
        await TestBed.configureTestingModule({ imports: [ConnectionEditDialogComponent] }).compileComponents();
        const fixture = TestBed.createComponent(ConnectionEditDialogComponent);
        const form = { ...createEmptyConnectionForm(), source: 'a', target: 'b', arrowFrom, arrowTo };
        fixture.componentRef.setInput('visible', true);
        fixture.componentRef.setInput('form', form);
        fixture.detectChanges();
        await fixture.whenStable();

        const session = new CastEditorSessionService();
        const board = { id: 'board', name: 'Cast', nodes: [], edges: [{ ...form, id: 'edge', type: '' }] };
        session.begin({ id: 'cast', name: 'Cast', pinboardId: 'board', characterIds: ['a', 'b'] }, board);
        const project = { path: '/test', metadata: { lastSession: { lastPinboardId: 'board' } } };
        const projects = {
          currentProject$: new BehaviorSubject(project), getCurrentProject: () => project,
          getCurrentPinboard: () => board,
        } as unknown as ProjectService;
        const service = TestBed.runInInjectionContext(() => new PinboardService(
          projects, {} as CharacterService, {} as CastService, session, {} as LoggingService,
        ));
        const graph = await service.getVisJsDataWithThumbnails([]);
        const ends = fixture.nativeElement.querySelectorAll('.preview-node-container');
        expect(!!ends[0].querySelector('.preview-arrow-indicator')).toBe(graph.edges[0].arrows.from.enabled);
        expect(!!ends[1].querySelector('.preview-arrow-indicator')).toBe(graph.edges[0].arrows.to.enabled);
        if (arrowFrom) expect(ends[0].querySelector('path').getAttribute('d')).toContain('L4 8');
        if (arrowTo) expect(ends[1].querySelector('path').getAttribute('d')).toContain('L12 8');
      });
    }
  }
});
