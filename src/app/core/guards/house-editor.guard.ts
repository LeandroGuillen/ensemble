import { CanDeactivateFn } from '@angular/router';
export const houseEditorGuard: CanDeactivateFn<{ canLeave(): boolean | Promise<boolean> }> = component => component.canLeave();
