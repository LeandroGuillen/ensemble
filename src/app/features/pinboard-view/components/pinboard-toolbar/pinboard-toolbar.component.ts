import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-pinboard-toolbar',
  templateUrl: './pinboard-toolbar.component.html',
  styleUrls: ['./pinboard-toolbar.component.scss'],
})
export class PinboardToolbarComponent {
  @Input() currentZoomLevel = '100%';
  @Input() canZoomIn = true;
  @Input() canZoomOut = true;
  @Input() showGrid = false;
  @Input() snapToGrid = true;

  @Output() zoomIn = new EventEmitter<void>();
  @Output() zoomOut = new EventEmitter<void>();
  @Output() resetView = new EventEmitter<void>();
  @Output() toggleGrid = new EventEmitter<void>();
  @Output() toggleSnapToGrid = new EventEmitter<void>();
  @Output() pinCharacter = new EventEmitter<void>();
}
