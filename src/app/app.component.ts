import { Component, OnInit } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { CommonModule } from "@angular/common";
import { ProjectService } from "./core/services";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
})
export class AppComponent implements OnInit {
  title = "Ensemble";
  hasProject = false;

  constructor(private projectService: ProjectService, private router: Router) {}

  ngOnInit() {
    this.projectService.currentProject$.subscribe((project: any) => {
      this.hasProject = !!project;
      if (!project) {
        this.router.navigate(["/project-selector"]);
      }
    });
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
}
