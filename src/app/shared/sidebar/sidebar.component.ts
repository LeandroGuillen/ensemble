import { Component, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ProjectService } from '../../core/services';
import { KeyboardShortcutsService } from '../keyboard-shortcuts-dialog/keyboard-shortcuts.service';
import { filter } from 'rxjs/operators';

interface NavItem {
  icon: string;
  label: string;
  route?: string;
  title: string;
  action?: () => void;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements OnInit {
  currentProjectName = '';
  currentRoute = '';
  isCollapsed = true;

  sections: NavSection[] = [
    {
      id: 'characters',
      label: 'Characters',
      items: [
        { icon: 'users', label: 'Characters', route: '/characters', title: 'Characters' },
        { icon: 'git-branch', label: 'Pinboard', route: '/pinboard', title: 'Pinboard' },
        { icon: 'theater', label: 'Casts', route: '/casts', title: 'Casts' }
      ]
    },
    {
      id: 'references',
      label: 'References',
      items: [
        { icon: 'book', label: 'Books', route: '/library', title: 'Books' },
        { icon: 'layout', label: 'Backstage', route: '/backstage', title: 'Backstage' }
      ]
    },
    {
      id: 'settings',
      label: 'Settings',
      items: [
        { icon: 'cpu', label: 'AI Settings', route: '/ai-settings', title: 'AI Settings' },
        { icon: 'settings', label: 'General', route: '/metadata', title: 'General Settings' }
      ]
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { icon: 'keyboard', label: 'Shortcuts', title: 'Keyboard Shortcuts', action: () => this.openShortcuts() }
      ]
    }
  ];

  constructor(
    private projectService: ProjectService,
    private router: Router,
    private shortcutsService: KeyboardShortcutsService
  ) {}

  ngOnInit(): void {
    this.projectService.currentProject$.subscribe((project: any) => {
      this.currentProjectName = project?.name || '';
    });

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.currentRoute = event.url;
      });

    // Load saved collapse state
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved !== null) {
      this.isCollapsed = saved === 'true';
    }

  }

  isActive(route: string): boolean {
    return this.currentRoute.startsWith(route);
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  handleItemClick(item: NavItem): void {
    if (item.action) {
      item.action();
    } else if (item.route) {
      this.navigateTo(item.route);
    }
  }

  selectProject(): void {
    this.router.navigate(['/project-selector']);
  }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
    localStorage.setItem('sidebar-collapsed', String(this.isCollapsed));
  }

  openShortcuts(): void {
    this.shortcutsService.open();
  }
}
