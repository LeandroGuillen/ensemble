import { CanDeactivateFn } from '@angular/router';

export const characterPickerGuard: CanDeactivateFn<{ canLeave(): boolean }> = component => component.canLeave();
