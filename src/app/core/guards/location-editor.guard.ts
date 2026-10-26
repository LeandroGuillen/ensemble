import { CanDeactivateFn } from '@angular/router';

export const locationEditorGuard: CanDeactivateFn<{ canLeave(): boolean | Promise<boolean> }> = component => component.canLeave();
