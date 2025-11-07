import { Component, OnInit, OnDestroy } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { BackstageService } from "../../core/services/backstage.service";
import {
  CharacterConcept,
  NameList,
} from "../../core/interfaces/backstage.interface";
import { PageHeaderComponent } from "../../shared/page-header/page-header.component";
import { ConceptCardComponent } from "./components/concept-card/concept-card.component";
import { NameListCardComponent } from "./components/name-list-card/name-list-card.component";

@Component({
  selector: "app-backstage",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    ConceptCardComponent,
    NameListCardComponent,
  ],
  templateUrl: "./backstage.component.html",
  styleUrls: ["./backstage.component.scss"],
})
export class BackstageComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  concepts: CharacterConcept[] = [];
  nameLists: NameList[] = [];
  isLoading = false;
  error: string | null = null;

  constructor(
    private backstageService: BackstageService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.backstageService
      .getBackstageData()
      .pipe(takeUntil(this.destroy$))
      .subscribe((data) => {
        this.concepts = data.concepts;
        this.nameLists = data.nameLists;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async addConcept(): Promise<void> {
    try {
      await this.backstageService.addConcept({
        title: "",
        notes: "",
      });
    } catch (error) {
      this.error = `Failed to add concept: ${error}`;
      console.error("Failed to add concept:", error);
    }
  }

  async updateConcept(
    index: number,
    updates: Partial<CharacterConcept>
  ): Promise<void> {
    try {
      await this.backstageService.updateConcept(index, updates);
    } catch (error) {
      this.error = `Failed to update concept: ${error}`;
      console.error("Failed to update concept:", error);
    }
  }

  async deleteConcept(index: number): Promise<void> {
    if (confirm("Are you sure you want to delete this concept?")) {
      try {
        await this.backstageService.deleteConcept(index);
      } catch (error) {
        this.error = `Failed to delete concept: ${error}`;
        console.error("Failed to delete concept:", error);
      }
    }
  }

  async takeTheStage(concept: CharacterConcept): Promise<void> {
    const name = concept.title || "";
    this.router.navigate(["/character/new"], {
      queryParams: { name: name },
    });
  }

  async addNameList(): Promise<void> {
    try {
      await this.backstageService.addNameList({
        title: "New List",
        names: [],
      });
    } catch (error) {
      this.error = `Failed to add name list: ${error}`;
      console.error("Failed to add name list:", error);
    }
  }

  async updateNameList(
    index: number,
    updates: Partial<NameList>
  ): Promise<void> {
    try {
      await this.backstageService.updateNameList(index, updates);
    } catch (error) {
      this.error = `Failed to update name list: ${error}`;
      console.error("Failed to update name list:", error);
    }
  }

  async deleteNameList(index: number): Promise<void> {
    if (confirm("Are you sure you want to delete this name list?")) {
      try {
        await this.backstageService.deleteNameList(index);
      } catch (error) {
        this.error = `Failed to delete name list: ${error}`;
        console.error("Failed to delete name list:", error);
      }
    }
  }

  async takeTheStageWithName(name: string): Promise<void> {
    this.router.navigate(["/character/new"], {
      queryParams: { name: name },
    });
  }

  async reload(): Promise<void> {
    try {
      this.isLoading = true;
      this.error = null;
      await this.backstageService.loadBackstageData();
    } catch (error) {
      this.error = `Failed to reload: ${error}`;
      console.error("Failed to reload backstage data:", error);
    } finally {
      this.isLoading = false;
    }
  }
}
