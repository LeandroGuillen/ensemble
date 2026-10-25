import { CanDeactivateFn } from '@angular/router';

export const locationEditorGuard: CanDeactivateFn<{ canLeave(): boolean }> = component => component.canLeave();
