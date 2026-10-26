import { CanDeactivateFn } from '@angular/router';

export const characterPickerGuard: CanDeactivateFn<{ canLeave(): boolean | Promise<boolean> }> = component => component.canLeave();
