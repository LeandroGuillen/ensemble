import { Component, ElementRef, ViewChild, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { OverlayModule } from '@angular/cdk/overlay';
import { LOCATION_TYPES, LocationType, getLocationPlaceholderIcon, getLocationTypeLabel, isLocationType } from '../../core/interfaces/location.interface';

@Component({
  selector: 'app-location-type-select',
  imports: [OverlayModule],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => LocationTypeSelectComponent), multi: true }],
  templateUrl: './location-type-select.component.html',
  styleUrls: ['./location-type-select.component.scss'],
})
export class LocationTypeSelectComponent implements ControlValueAccessor {
  @ViewChild('trigger') trigger?: ElementRef<HTMLButtonElement>;
  readonly options = [
    { value: '' as const, label: 'Unspecified', icon: 'map' },
    ...LOCATION_TYPES,
  ];
  readonly getIcon = getLocationPlaceholderIcon;
  readonly getLabel = getLocationTypeLabel;
  value: LocationType | '' = '';
  disabled = false;
  open = false;
  activeIndex = 0;
  private onChange: (value: LocationType | '') => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: unknown): void {
    this.value = isLocationType(value) ? value : '';
  }

  registerOnChange(fn: (value: LocationType | '') => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
    if (disabled) this.open = false;
  }

  toggle(): void {
    if (this.disabled) return;
    this.open = !this.open;
    this.activeIndex = this.options.findIndex((option) => option.value === this.value);
  }

  close(): void {
    this.open = false;
    this.onTouched();
  }

  select(index: number): void {
    this.value = this.options[index].value;
    this.onChange(this.value);
    this.close();
    this.trigger?.nativeElement.focus();
  }

  onBlur(): void {
    this.onTouched();
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.disabled) return;
    if (event.key === 'Tab') {
      this.close();
      return;
    }
    if (event.key === 'Escape' && this.open) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      if (this.open) this.select(this.activeIndex);
      else this.toggle();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.open) this.toggle();
      else if (event.key === 'ArrowDown') this.activeIndex = (this.activeIndex + 1) % this.options.length;
      else if (event.key === 'ArrowUp') this.activeIndex = (this.activeIndex + this.options.length - 1) % this.options.length;
      if (event.key === 'Home') this.activeIndex = 0;
      if (event.key === 'End') this.activeIndex = this.options.length - 1;
      this.scrollActiveOption();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const index = this.options.findIndex((option) => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (index >= 0) {
        event.preventDefault();
        if (!this.open) this.toggle();
        this.activeIndex = index;
        this.scrollActiveOption();
      }
    }
  }

  scrollActiveOption(): void {
    setTimeout(() => document.getElementById(`location-type-option-${this.activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' }));
  }
}
