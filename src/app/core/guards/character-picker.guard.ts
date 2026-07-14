import { CanDeactivateFn } from '@angular/router';

interface CharacterPickerNavigationTarget {
  handlePickerNavigationAway(): boolean;
}

export const characterPickerGuard: CanDeactivateFn<CharacterPickerNavigationTarget> = (
  component
) => component.handlePickerNavigationAway();
