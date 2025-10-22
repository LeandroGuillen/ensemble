import { Component, OnInit, HostListener } from "@angular/core";
import { Router, RouterOutlet, NavigationEnd } from "@angular/router";
import { CommonModule } from "@angular/common";
import { Title } from "@angular/platform-browser";
import { ProjectService, ElectronService } from "./core/services";
import { filter } from "rxjs/operators";
import { CommandPaletteComponent } from "./shared/command-palette/command-palette.component";
import { CommandPaletteService } from "./shared/command-palette/command-palette.service";
import { SidebarComponent } from "./shared/sidebar/sidebar.component";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, RouterOutlet, CommandPaletteComponent, SidebarComponent],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
})
export class AppComponent implements OnInit {
  title = "Ensemble";
  hasProject = false;
  isWelcomeScreen = false;
  private projectLoadedAndReady = false;

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
        this.projectLoadedAndReady = true;

        // Restore the last visited route if it exists
        const lastRoute = this.projectService.getLastRoute();
        if (lastRoute && lastRoute !== '/project-selector') {
          // Use setTimeout to ensure routing happens after Angular is ready
          setTimeout(() => {
            this.router.navigate([lastRoute]);
          }, 0);
        } else {
          // Default to characters page if no last route
          setTimeout(() => {
            this.router.navigate(['/characters']);
          }, 0);
        }
      } catch (error) {
        console.warn('Failed to auto-load most recent project:', error);
        // If loading fails, user will be redirected to project selector by subscription below
      }
    }

    this.projectService.currentProject$.subscribe((project: any) => {
      this.hasProject = !!project;
      if (!project) {
        this.router.navigate(["/project-selector"]);
      }
    });

    // Track route changes and save to project settings
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.isWelcomeScreen = event.url === '/project-selector' || event.url === '/';

        // Save the current route to project settings (but not the project selector)
        if (this.hasProject && !this.isWelcomeScreen) {
          // Use setTimeout to debounce rapid navigation changes
          setTimeout(() => {
            this.projectService.saveLastRoute(event.url);
          }, 500);
        }
      });
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
