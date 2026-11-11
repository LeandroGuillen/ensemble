import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProjectHealthComponent } from './project-health.component';
import { ProjectHealthService } from '../../core/services/project-health.service';
import { ProjectService } from '../../core/services/project.service';

describe('Project health page', () => {
  it('groups findings, links to source records and refreshes after a confirmed repair', fakeAsync(() => {
    const finding = { name: 'Court', content: '', group: 'Orphaned IDs', message: 'Members: missing ID gone',
      route: ['/cast', 'court'], fix: { kind: 'cast', owner: 'court', field: 'Members', missing: 'gone' } };
    const health = { scan: jasmine.createSpy().and.resolveTo([finding]), repair: jasmine.createSpy().and.resolveTo(true) };
    TestBed.configureTestingModule({ imports: [ProjectHealthComponent], providers: [provideRouter([]),
      { provide: ProjectHealthService, useValue: health }, { provide: ProjectService, useValue: { getCurrentProject: () => null } },
    ] });
    const fixture = TestBed.createComponent(ProjectHealthComponent);
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2').textContent).toContain('Orphaned IDs');
    expect(fixture.nativeElement.querySelector('li a').getAttribute('href')).toBe('/cast/court');
    health.scan.and.resolveTo([]);
    fixture.nativeElement.querySelector('li button').click();
    flushMicrotasks();
    fixture.detectChanges();
    expect(health.repair).toHaveBeenCalledOnceWith(finding);
    expect(fixture.nativeElement.textContent).toContain('No issues found.');
  }));
});
