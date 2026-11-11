import { ChangeDetectorRef, Component, Input, DestroyRef, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { ProjectHealthService } from '../../core/services/project-health.service';
import { ProjectService } from '../../core/services/project.service';
import { HealthFinding } from '../../core/utils/project-health.utils';

@Component({
  selector: 'app-project-health',
  imports: [RouterLink, PageHeaderComponent],
  template: `
    @if (embedded) {
      <button class="btn btn-secondary" (click)="refresh()" [disabled]="busy">Run checks</button>
    } @else {
    <app-page-header title="Project health">
      <button class="btn btn-secondary" (click)="refresh()" [disabled]="busy">Run checks</button>
    </app-page-header>
    }
    <main [attr.aria-busy]="busy">
      <p>Check wiki links, names and aliases, references, and portraits for the selected character style.</p>
      <label>Portrait style
        <select [value]="portraitStyle" [disabled]="busy" (change)="changeStyle($event)">
          @for (style of portraitStyles; track style.id) { <option [value]="style.id">{{ style.name }}</option> }
        </select>
      </label>
      <p>Checks are read-only. Removing an orphaned ID requires confirmation.</p>
      @if (inspectedPinboard; as board) {
        <section aria-label="Pinboard record">
          <h2>Pinboard: {{ board.name }}</h2>
          <p>ID: {{ board.id }}</p>
          <h3>Nodes</h3>
          <ul>@for (node of board.nodes; track $index) { <li>{{ node.name || node.id }} ({{ node.id }})</li> }</ul>
          <h3>Connections</h3>
          <ul>@for (edge of board.edges; track $index) { <li>{{ edge.label || edge.id }}: {{ edge.source }} → {{ edge.target }}</li> }</ul>
        </section>
      }
      @if (error) { <p role="alert">{{ error }}</p> }
      <p role="status">{{ busy ? 'Checking project…' : completed ? count + ' findings' : '' }}</p>
      @if (completed && !count && !error) { <p>No issues found.</p> }
      @for (group of groups; track group.name) {
        <section>
          <h2>{{ group.name }} <span>({{ group.findings.length }})</span></h2>
          <ul>
            @for (finding of group.findings; track $index) {
              <li>
                <div><a [routerLink]="finding.route" [queryParams]="finding.queryParams">{{ finding.name }}</a>
                  <p>{{ finding.message }}</p></div>
                @if (finding.fix) {
                  <button class="btn btn-secondary" [disabled]="busy" (click)="repair(finding)"
                    [attr.aria-label]="'Remove orphaned ID from ' + finding.name">Remove ID…</button>
                }
              </li>
            }
          </ul>
        </section>
      }
    </main>`,
  styles: [`
    :host { display: block; flex: 1; min-width: 0; overflow: auto; background: var(--color-bg-primary); }
    main { padding: 24px; max-width: 1100px; margin: auto; }
    section { margin-top: 28px; }
    h2 { font-size: 1.15rem; } h2 span { opacity: .65; }
    ul { padding: 0; list-style: none; }
    li { display: flex; align-items: center; justify-content: space-between; gap: 20px;
      padding: 12px 0; border-bottom: 1px solid var(--color-border); }
    a { color: var(--color-accent-primary); } li p { margin: 6px 0; overflow-wrap: anywhere; }
    button { flex-shrink: 0; }
  `],
})
export class ProjectHealthComponent implements OnInit {
  @Input() embedded = false;
  private readonly health = inject(ProjectHealthService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly projects = inject(ProjectService);
  get inspectedPinboard() {
    return this.projects.getCurrentProject()?.metadata.pinboards?.find(board => board.id === this.route.snapshot.paramMap.get('pinboardId'));
  }
  portraitStyle = this.projects.getCurrentProject()?.metadata.lastSession?.lastCharacterListStyle
    || this.projects.getCurrentProject()?.metadata.settings.defaultCharacterStyle || 'default';
  get portraitStyles() {
    return this.projects.getCurrentProject()?.metadata.settings.characterStyles?.length
      ? this.projects.getCurrentProject()!.metadata.settings.characterStyles! : [{ id: 'default', name: 'Default' }];
  }
  changeStyle(event: Event): void {
    this.portraitStyle = (event.target as HTMLSelectElement).value;
    void this.refresh();
  }
  busy = false;
  completed = false;
  error = '';
  count = 0;
  groups: { name: string; findings: HealthFinding[] }[] = [];

  ngOnInit(): void { void this.refresh(); }

  async refresh(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    try { await this.runChecks(); }
    catch (error) { this.error = error instanceof Error ? error.message : 'Could not check project.'; }
    finally { this.busy = false; if (!this.destroyRef.destroyed) this.cdr.detectChanges(); }
  }

  private async runChecks(): Promise<void> {
    const findings = await this.health.scan(this.portraitStyle);
    const grouped = new Map<string, HealthFinding[]>();
    for (const finding of findings) {
      if (!grouped.has(finding.group)) grouped.set(finding.group, []);
      grouped.get(finding.group)!.push(finding);
    }
    this.groups = [...grouped].map(([name, items]) => ({ name, findings: items }));
    this.count = findings.length;
    this.completed = true;
  }

  async repair(finding: HealthFinding): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    try { if (await this.health.repair(finding)) await this.runChecks(); }
    catch (error) { this.error = error instanceof Error ? error.message : 'Could not remove the ID.'; }
    finally { this.busy = false; if (!this.destroyRef.destroyed) this.cdr.detectChanges(); }
  }
}
