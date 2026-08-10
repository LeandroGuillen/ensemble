import { Component, OnDestroy, OnInit, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { MetadataManagementComponent } from '../metadata-management/metadata-management.component';
import { AiSettingsComponent } from '../ai-settings/ai-settings.component';
import { ProjectService } from '../../core/services/project.service';
import { ThemeService } from '../../core/services/theme.service';
import { ColorPaletteService } from '../../core/services/color-palette.service';
import { ZoomService } from '../../core/services/zoom.service';
import { AiService } from '../../core/services/ai.service';
import { ImageGenerationService } from '../../core/services/image-generation/image-generation.service';
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTION_ALIASES,
  SETTINGS_SECTION_IDS,
  SettingsSectionId,
} from './settings-section';
import { SETTINGS_FIELD_INDEX, SettingsFieldIndex } from './settings-field-index';
import { SettingsSearchService } from './settings-search.service';

interface SettingsNavLeaf {
  id: SettingsSectionId;
  label: string;
  description: string;
}

interface SettingsNavGroup {
  id: string;
  label: string;
  children: SettingsNavLeaf[];
}

interface SettingsNavLeafEntry extends SettingsNavLeaf {
  kind: 'leaf';
}

type SettingsNavEntry = (SettingsNavGroup & { kind: 'group' }) | SettingsNavLeafEntry;

export interface SettingsSearchMatch {
  field: SettingsFieldIndex;
  sectionLabel: string;
  valuePreview: string | null;
}

const VALID_SECTIONS = new Set<SettingsSectionId>(SETTINGS_SECTION_IDS);

const SETTINGS_NAV_EXPANDED_GROUPS_KEY = 'settingsNavExpandedGroups';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, PageHeaderComponent, MetadataManagementComponent, AiSettingsComponent],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  activeSection: SettingsSectionId = DEFAULT_SETTINGS_SECTION;
  expandedGroups = new Set<string>();
  searchQuery = '';
  searchMatches: SettingsSearchMatch[] = [];
  filteredNavEntries: SettingsNavEntry[] = [];

  readonly navEntries: SettingsNavEntry[] = [
    {
      kind: 'leaf',
      id: 'general',
      label: 'General',
      description: 'Folders, paths, and updates',
    },
    {
      kind: 'leaf',
      id: 'appearance',
      label: 'Appearance',
      description: 'Theme, colors, and interface zoom',
    },
    {
      kind: 'group',
      id: 'characters',
      label: 'Characters',
      children: [
        {
          id: 'categories',
          label: 'Categories',
          description: 'Character categories, folder modes, and default',
        },
        {
          id: 'tags',
          label: 'Tags',
          description: 'Tags used across characters',
        },
        {
          id: 'character-styles',
          label: 'Character Styles',
          description: 'Portrait styles for characters',
        },
      ],
    },
    {
      kind: 'group',
      id: 'ai-group',
      label: 'AI',
      children: [
        {
          id: 'ai',
          label: 'Language Model',
          description: 'Local and cloud AI providers',
        },
        {
          id: 'image-generation',
          label: 'Image Generation',
          description: 'InvokeAI character portraits',
        },
      ],
    },
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private projectService: ProjectService,
    private themeService: ThemeService,
    private colorPaletteService: ColorPaletteService,
    private zoomService: ZoomService,
    private aiService: AiService,
    private imageGenerationService: ImageGenerationService,
    private settingsSearch: SettingsSearchService
  ) {
    this.expandedGroups = this.loadExpandedGroups();
    this.expandGroupForSection(this.activeSection);
    this.filteredNavEntries = this.navEntries;
  }

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const requested = params.get('section');
      const resolved = this.resolveSection(requested);
      if (resolved) {
        this.activeSection = resolved;
        this.expandGroupForSection(resolved);
        if (requested !== resolved) {
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { section: resolved },
            replaceUrl: true,
          });
        }
        return;
      }
      this.activeSection = DEFAULT_SETTINGS_SECTION;
      this.expandGroupForSection(DEFAULT_SETTINGS_SECTION);
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { section: DEFAULT_SETTINGS_SECTION },
        replaceUrl: true,
      });
    });
  }

  ngOnDestroy(): void {
    this.settingsSearch.clear();
  }

  onSearchChange(query: string): void {
    this.searchQuery = query;
    this.settingsSearch.setQuery(query);
    this.applySearchFilter();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.settingsSearch.clear();
    this.applySearchFilter();
  }

  selectSection(section: SettingsSectionId): void {
    if (section === this.activeSection) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { section },
      queryParamsHandling: 'merge',
    });
  }

  selectSearchMatch(match: SettingsSearchMatch): void {
    this.selectSection(match.field.section);
  }

  toggleGroup(groupId: string): void {
    if (this.hasActiveSearch) {
      return;
    }
    if (this.expandedGroups.has(groupId)) {
      this.expandedGroups.delete(groupId);
    } else {
      this.expandedGroups.add(groupId);
    }
    this.expandedGroups = new Set(this.expandedGroups);
    this.persistExpandedGroups();
  }

  isGroupExpanded(groupId: string): boolean {
    if (this.hasActiveSearch) {
      return this.filteredNavEntries.some(
        (entry) => entry.kind === 'group' && entry.id === groupId
      );
    }
    return this.expandedGroups.has(groupId);
  }

  isGroupActive(group: SettingsNavGroup): boolean {
    return group.children.some((child) => child.id === this.activeSection);
  }

  isProjectSection(section: SettingsSectionId): boolean {
    return (
      section === 'general' ||
      section === 'appearance' ||
      section === 'categories' ||
      section === 'tags' ||
      section === 'character-styles'
    );
  }

  isAiSection(section: SettingsSectionId): boolean {
    return section === 'ai' || section === 'image-generation';
  }

  get activeNavItem(): SettingsNavLeaf {
    for (const entry of this.navEntries) {
      if (entry.kind === 'leaf' && entry.id === this.activeSection) {
        return entry;
      }
      if (entry.kind === 'group') {
        const child = entry.children.find((c) => c.id === this.activeSection);
        if (child) {
          return child;
        }
      }
    }
    return {
      id: DEFAULT_SETTINGS_SECTION,
      label: 'General',
      description: 'Folders, paths, and updates',
    };
  }

  get hasActiveSearch(): boolean {
    return this.searchQuery.trim().length > 0;
  }

  private applySearchFilter(): void {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) {
      this.searchMatches = [];
      this.filteredNavEntries = this.navEntries;
      return;
    }

    const valueMap = this.buildValueMap();
    const matches: SettingsSearchMatch[] = [];
    const matchingSections = new Set<SettingsSectionId>();

    for (const field of SETTINGS_FIELD_INDEX) {
      const valueParts = (field.valueKeys || [])
        .map((key) => valueMap[key])
        .filter((v): v is string => !!v);
      const haystack = [field.label, ...field.keywords, ...valueParts]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) {
        continue;
      }
      matchingSections.add(field.section);
      matches.push({
        field,
        sectionLabel: this.getSectionLabel(field.section),
        valuePreview: valueParts[0] || null,
      });
    }

    // Also match section titles/descriptions themselves
    for (const entry of this.navEntries) {
      if (entry.kind === 'leaf') {
        if (this.navLeafMatches(entry, query)) {
          matchingSections.add(entry.id);
        }
      } else {
        for (const child of entry.children) {
          if (this.navLeafMatches(child, query) || entry.label.toLowerCase().includes(query)) {
            matchingSections.add(child.id);
          }
        }
      }
    }

    this.searchMatches = matches;
    this.filteredNavEntries = this.filterNavEntries(matchingSections);

    // Jump to first match if current section isn't in results
    if (matchingSections.size > 0 && !matchingSections.has(this.activeSection)) {
      const first =
        matches[0]?.field.section ||
        ([...matchingSections][0] as SettingsSectionId);
      this.selectSection(first);
    }
  }

  private navLeafMatches(leaf: SettingsNavLeaf, query: string): boolean {
    return (
      leaf.label.toLowerCase().includes(query) ||
      leaf.description.toLowerCase().includes(query)
    );
  }

  private filterNavEntries(matchingSections: Set<SettingsSectionId>): SettingsNavEntry[] {
    const result: SettingsNavEntry[] = [];
    for (const entry of this.navEntries) {
      if (entry.kind === 'leaf') {
        if (matchingSections.has(entry.id)) {
          result.push(entry);
        }
        continue;
      }
      const children = entry.children.filter((child) => matchingSections.has(child.id));
      if (children.length > 0) {
        result.push({ ...entry, children });
      }
    }
    return result;
  }

  private getSectionLabel(section: SettingsSectionId): string {
    for (const entry of this.navEntries) {
      if (entry.kind === 'leaf' && entry.id === section) {
        return entry.label;
      }
      if (entry.kind === 'group') {
        const child = entry.children.find((c) => c.id === section);
        if (child) {
          return child.label;
        }
      }
    }
    return section;
  }

  private buildValueMap(): Record<string, string> {
    const project = this.projectService.getCurrentProject();
    const settings = project?.metadata.settings;
    const categories = project?.metadata.categories || [];
    const tags = project?.metadata.tags || [];
    const styles = this.projectService.getCharacterStyles();
    const theme = this.themeService.getCurrentTheme();
    const ai = settings?.ai;
    const image = this.imageGenerationService.getSettings();

    const defaultCategory = categories.find((c) => c.id === settings?.defaultCategory);

    return {
      defaultCategory: settings?.defaultCategory || '',
      defaultCategoryName: defaultCategory?.name || '',
      zoomPercent: `${this.zoomService.getZoomPercent()}%`,
      charactersFolder: settings?.charactersFolder || 'characters',
      castsFolder: settings?.castsFolder || 'characters/casts',
      namesFile: settings?.namesFile || 'characters/names.md',
      imagesFolder: settings?.imagesFolder || 'img',
      theme: settings?.theme || theme?.id || '',
      themeName: theme?.name || '',
      colorPaletteColors: this.colorPaletteService.getAllColors().join(' '),
      categoryNames: categories.map((c) => c.name).join(' '),
      tagNames: tags.map((t) => t.name).join(' '),
      characterStyleNames: styles.map((s) => s.name).join(' '),
      defaultCharacterStyle: settings?.defaultCharacterStyle || '',
      aiEnabled: ai?.enabled ? 'enabled' : 'disabled',
      aiProvider: ai?.provider || '',
      aiServerUrl: ai?.localServerUrl || '',
      aiModelName: ai?.modelName || '',
      aiTemperature: ai?.temperature != null ? String(ai.temperature) : '',
      aiMaxTokens: ai?.maxTokens != null ? String(ai.maxTokens) : '',
      imageGenEnabled: image.enabled ? 'enabled' : 'disabled',
      invokeAiBaseUrl: image.invokeai.baseUrl || '',
      defaultWorkflowId: image.invokeai.defaultWorkflowId || '',
      comfyUiBaseUrl: image.comfyui?.baseUrl || '',
      comfyDefaultWorkflowId: image.comfyui?.defaultWorkflowId || '',
    };
  }

  private resolveSection(requested: string | null): SettingsSectionId | null {
    if (!requested) {
      return null;
    }
    if (VALID_SECTIONS.has(requested as SettingsSectionId)) {
      return requested as SettingsSectionId;
    }
    return SETTINGS_SECTION_ALIASES[requested] ?? null;
  }

  private expandGroupForSection(section: SettingsSectionId): void {
    for (const entry of this.navEntries) {
      if (entry.kind === 'group' && entry.children.some((c) => c.id === section)) {
        if (!this.expandedGroups.has(entry.id)) {
          this.expandedGroups.add(entry.id);
          this.expandedGroups = new Set(this.expandedGroups);
          this.persistExpandedGroups();
        }
        return;
      }
    }
  }

  private getDefaultExpandedGroups(): Set<string> {
    return new Set(
      this.navEntries.filter((entry) => entry.kind === 'group').map((entry) => entry.id)
    );
  }

  private loadExpandedGroups(): Set<string> {
    try {
      const raw = localStorage.getItem(SETTINGS_NAV_EXPANDED_GROUPS_KEY);
      if (raw === null) {
        return this.getDefaultExpandedGroups();
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return this.getDefaultExpandedGroups();
      }
      const knownIds = new Set(
        this.navEntries.filter((entry) => entry.kind === 'group').map((entry) => entry.id)
      );
      return new Set(
        parsed.filter((id): id is string => typeof id === 'string' && knownIds.has(id))
      );
    } catch {
      return this.getDefaultExpandedGroups();
    }
  }

  private persistExpandedGroups(): void {
    localStorage.setItem(
      SETTINGS_NAV_EXPANDED_GROUPS_KEY,
      JSON.stringify([...this.expandedGroups])
    );
  }
}
