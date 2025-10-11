import { Component, OnInit, HostListener } from "@angular/core";
import { Router, RouterOutlet, NavigationEnd } from "@angular/router";
import { CommonModule } from "@angular/common";
import { Title } from "@angular/platform-browser";
import { ProjectService, ElectronService } from "./core/services";
import { filter } from "rxjs/operators";
import { CommandPaletteComponent } from "./shared/command-palette/command-palette.component";
import { CommandPaletteService } from "./shared/command-palette/command-palette.service";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, RouterOutlet, CommandPaletteComponent],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
})
export class AppComponent implements OnInit {
  title = "Ensemble";
  hasProject = false;
  currentProjectName = "";
  currentRoute = "";
  isWelcomeScreen = false;

  constructor(
    private projectService: ProjectService,
    private router: Router,
    private commandPaletteService: CommandPaletteService,
    private titleService: Title,
    private electronService: ElectronService
  ) {}

  async ngOnInit() {
    // Set the app title with version
    try {
      const version = await this.electronService.getVersion();
      this.titleService.setTitle(`Ensemble v${version} - Character Management`);
    } catch (error) {
      console.warn('Failed to get app version:', error);
      this.titleService.setTitle('Ensemble - Character Management');
    }

    // Try to auto-load the most recent project
    const mostRecentProject = this.projectService.getMostRecentProject();
    if (mostRecentProject) {
      try {
        await this.projectService.loadProject(mostRecentProject);
      } catch (error) {
        console.warn('Failed to auto-load most recent project:', error);
        // If loading fails, user will be redirected to project selector by subscription below
      }
    }

    this.projectService.currentProject$.subscribe((project: any) => {
      this.hasProject = !!project;
      this.currentProjectName = project?.name || "";
      if (!project) {
        this.router.navigate(["/project-selector"]);
      }
    });

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.currentRoute = event.url;
        this.isWelcomeScreen = event.url === '/project-selector' || event.url === '/';
      });
  }

  isActive(route: string): boolean {
    return this.currentRoute.startsWith(route);
  }

  navigateToList() {
    this.router.navigate(["/characters"]);
  }

  navigateToGraph() {
    this.router.navigate(["/graph"]);
  }

  navigateToMetadata() {
    this.router.navigate(["/metadata"]);
  }

  selectProject() {
    this.router.navigate(["/project-selector"]);
  }

  openCommandPalette() {
    this.commandPaletteService.open();
  }

  @HostListener('document:keydown', ['$event'])
  handleGlobalKeydown(event: KeyboardEvent): void {
    // Handle command palette shortcuts at the app level
    if ((event.ctrlKey && event.key === 'p') || 
        (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA')) {
      event.preventDefault();
      event.stopPropagation();
      this.commandPaletteService.open();
      return;
    }
  }
}
