import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { CalendarMonth, WorldCalendar } from '../../core/interfaces/timeline.interface';
import { NotificationService } from '../../core/services/notification.service';
import { ProjectService } from '../../core/services/project.service';
import { DEFAULT_CHRONICLE_FILE } from '../../core/services/timeline.service';
import { DEFAULT_CALENDAR, daysInYear, resolveCalendar } from '../../core/utils/world-date.utils';
import { SettingsSearchableDirective } from '../settings/settings-searchable.directive';

/** Settings › Timeline: the project calendar (months) and the chronicle file path. */
@Component({
  selector: 'app-timeline-settings',
  imports: [FormsModule, SettingsSearchableDirective],
  templateUrl: './timeline-settings.component.html',
  styleUrl: './timeline-settings.component.scss',
})
export class TimelineSettingsComponent implements OnInit {
  private readonly projects = inject(ProjectService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly defaultChronicle = DEFAULT_CHRONICLE_FILE;
  name = '';
  suffix = '';
  months: CalendarMonth[] = [];
  chronicleFile = '';
  saving = false;
  private savedKey = '';

  ngOnInit(): void {
    this.projects.currentProject$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((project) => {
      if (!project || this.dirty) return;
      const calendar = resolveCalendar(project.metadata.settings.calendar);
      this.name = calendar.name ?? '';
      this.suffix = calendar.suffix ?? '';
      this.months = calendar.months.map((m) => ({ ...m }));
      this.chronicleFile = project.metadata.settings.chronicleFile ?? '';
      this.savedKey = this.key();
    });
  }

  get dirty(): boolean {
    return !!this.savedKey && this.key() !== this.savedKey;
  }

  get yearLength(): number {
    return daysInYear({ months: this.months.filter((m) => m.days > 0) });
  }

  get monthsValid(): boolean {
    return this.months.length > 0 && this.months.every((m) => m.name.trim() && Number.isInteger(Number(m.days)) && Number(m.days) > 0 && Number(m.days) <= 400);
  }

  private key(): string {
    return JSON.stringify([this.name, this.suffix, this.months, this.chronicleFile]);
  }

  addMonth(): void {
    this.months = [...this.months, { name: `Month ${this.months.length + 1}`, days: 30 }];
  }

  removeMonth(index: number): void {
    this.months = this.months.filter((_, i) => i !== index);
  }

  moveMonth(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= this.months.length) return;
    const months = [...this.months];
    [months[index], months[target]] = [months[target], months[index]];
    this.months = months;
  }

  useDefaultMonths(): void {
    this.months = DEFAULT_CALENDAR.months.map((m) => ({ ...m }));
  }

  revert(): void {
    this.savedKey = '';
    const project = this.projects.getCurrentProject();
    if (!project) return;
    const calendar = resolveCalendar(project.metadata.settings.calendar);
    this.name = calendar.name ?? '';
    this.suffix = calendar.suffix ?? '';
    this.months = calendar.months.map((m) => ({ ...m }));
    this.chronicleFile = project.metadata.settings.chronicleFile ?? '';
    this.savedKey = this.key();
  }

  async save(): Promise<void> {
    const project = this.projects.getCurrentProject();
    if (!project || this.saving) return;
    if (!this.monthsValid) {
      this.notifications.showError('Each month needs a name and between 1 and 400 days.');
      return;
    }
    const chronicleFile = this.chronicleFile.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (chronicleFile && (!chronicleFile.toLowerCase().endsWith('.md') || chronicleFile.split('/').includes('..'))) {
      this.notifications.showError('The chronicle file must be a .md path inside the project.');
      return;
    }
    const calendar: WorldCalendar = {
      ...(this.name.trim() ? { name: this.name.trim() } : {}),
      ...(this.suffix.trim() ? { suffix: this.suffix.trim() } : {}),
      months: this.months.map((m) => ({ name: m.name.trim(), days: Number(m.days) })),
    };
    const settings = { ...project.metadata.settings, calendar };
    if (chronicleFile && chronicleFile !== DEFAULT_CHRONICLE_FILE) settings.chronicleFile = chronicleFile;
    else delete settings.chronicleFile;
    this.saving = true;
    try {
      await this.projects.updateMetadata({ settings });
      this.chronicleFile = settings.chronicleFile ?? '';
      this.savedKey = this.key();
      this.notifications.showSuccess('Timeline settings saved');
    } catch (error) {
      this.notifications.showError(`Could not save: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.saving = false;
    }
  }
}
