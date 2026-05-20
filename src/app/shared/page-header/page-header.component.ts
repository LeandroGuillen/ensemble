import { Component, Input } from '@angular/core';

import { CommandPaletteService } from '../command-palette/command-palette.service';

@Component({
    selector: 'app-page-header',
    imports: [],
    templateUrl: './page-header.component.html',
    styleUrls: ['./page-header.component.scss']
})
export class PageHeaderComponent {
  @Input() title: string = '';
  @Input() showSearch: boolean = true;

  constructor(private commandPaletteService: CommandPaletteService) {}

  openCommandPalette(): void {
    this.commandPaletteService.open();
  }
}
