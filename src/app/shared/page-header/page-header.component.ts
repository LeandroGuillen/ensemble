import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommandPaletteService } from '../command-palette/command-palette.service';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [CommonModule],
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
