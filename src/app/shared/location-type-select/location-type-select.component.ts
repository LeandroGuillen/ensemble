import { Component, ElementRef, Input, ViewChild, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { OverlayModule } from '@angular/cdk/overlay';
import { LOCATION_TYPES, LOCATION_MAP_ICONS, normalizeLocationMapIcon, LocationType, getLocationPlaceholderIcon, isLocationType } from '../../core/interfaces/location.interface';

let nextSelectId = 0;

@Component({
  selector: 'app-location-type-select',
  imports: [OverlayModule],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => LocationTypeSelectComponent), multi: true }],
  templateUrl: './location-type-select.component.html',
  styleUrls: ['./location-type-select.component.scss'],
})
export class LocationTypeSelectComponent implements ControlValueAccessor {
  @ViewChild('trigger') trigger?: ElementRef<HTMLButtonElement>;
  @Input() mode: 'type' | 'icon' = 'type';
  @Input() locationType: LocationType | '' | undefined;
  readonly instanceId = `location-select-${++nextSelectId}`;
  get controlId(): string { return this.mode === 'icon' ? 'mapIcon' : 'locationType'; }
  get options() {
    return this.mode === 'icon'
      ? [{ value: '', label: 'Default for type' }, ...LOCATION_MAP_ICONS]
      : [{ value: '', label: 'Unspecified' }, ...LOCATION_TYPES];
  }
  getIcon(value: string | undefined): string {
    return this.mode === 'icon'
      ? value ? `assets/ui-icons.svg#${value}` : getLocationPlaceholderIcon(this.locationType || undefined)
      : getLocationPlaceholderIcon(isLocationType(value) ? value : undefined);
  }
  getLabel(value: string | undefined): string {
    return this.options.find(option => option.value === (value || ''))?.label || '';
  }
  value = '';
  disabled = false;
  open = false;
  activeIndex = 0;
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: unknown): void {
    this.value = this.mode === 'icon' ? normalizeLocationMapIcon(value) || '' : isLocationType(value) ? value : '';
  }

  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
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
    // Ctrl/Cmd+Enter is the editor's Save shortcut: commit any open choice and let it through.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      if (this.open) this.select(this.activeIndex);
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
    setTimeout(() => document.getElementById(`${this.instanceId}-option-${this.activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' }));
  }
}
