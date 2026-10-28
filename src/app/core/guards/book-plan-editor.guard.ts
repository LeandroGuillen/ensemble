import { CanDeactivateFn } from '@angular/router';

export const bookPlanEditorGuard: CanDeactivateFn<{ canLeave(): boolean | Promise<boolean> }> = (
  component
) => component.canLeave();
