import { CanDeactivateFn } from '@angular/router';
export const houseEditorGuard: CanDeactivateFn<{ canLeave(): boolean }> = component => component.canLeave();
