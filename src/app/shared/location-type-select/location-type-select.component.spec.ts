import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { OverlayContainer } from '@angular/cdk/overlay';
import { LocationTypeSelectComponent } from './location-type-select.component';

@Component({
  imports: [ReactiveFormsModule, LocationTypeSelectComponent],
  template: '<app-location-type-select [formControl]="type" />',
})
class TestHost {
  type = new FormControl('settlement');
}

describe('LocationTypeSelectComponent', () => {
  it('shows icons on every option and writes a clicked choice to the form', () => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(trigger.textContent).toContain('Settlement');
    trigger.click();
    fixture.detectChanges();
    const options = TestBed.inject(OverlayContainer).getContainerElement().querySelectorAll('[role="option"]');
    expect(options.length).toBe(10);
    options.forEach((option) => expect(option.querySelector('svg use')).not.toBeNull());
    (options[1] as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.type.value).toBe('country');
    expect(fixture.componentInstance.type.dirty).toBeTrue();
    expect(fixture.componentInstance.type.touched).toBeTrue();
    expect(trigger.textContent).toContain('Country');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('supports keyboard selection, Escape without cancelling the editor, and disabling', () => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    const press = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      trigger.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    };
    press('ArrowDown');
    press('End');
    press('Enter');
    expect(fixture.componentInstance.type.value).toBe('other');
    trigger.click();
    fixture.detectChanges();
    expect(press('Escape').defaultPrevented).toBeTrue();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fixture.componentInstance.type.disable();
    fixture.detectChanges();
    expect(trigger.disabled).toBeTrue();
  });

  it('lets Ctrl+Enter through to the editor (Save) instead of opening the list', () => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    let reachedDocument = false;
    const listener = () => { reachedDocument = true; };
    document.addEventListener('keydown', listener);
    try {
      const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
      trigger.dispatchEvent(event);
      fixture.detectChanges();
      expect(event.defaultPrevented).toBeFalse();
      expect(reachedDocument).toBeTrue();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    } finally {
      document.removeEventListener('keydown', listener);
    }
  });
});

@Component({
  imports: [ReactiveFormsModule, LocationTypeSelectComponent],
  template: `<app-location-type-select [formControl]="type" />
    <app-location-type-select mode="icon" [locationType]="type.value || ''" [formControl]="icon" />`,
})
class IconTestHost {
  type = new FormControl<'settlement' | 'country'>('settlement');
  icon = new FormControl('');
}

describe('Location icon selection', () => {
  it('shows the current type icon for the default and updates it when the type changes', () => {
    const fixture = TestBed.createComponent(IconTestHost);
    fixture.detectChanges();
    const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('#mapIcon');
    expect(trigger.textContent).toContain('Default for type');
    expect(trigger.querySelector('use')!.getAttribute('href')).toBe('assets/ui-icons.svg#settlement');
    fixture.componentInstance.type.setValue('country');
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(trigger.querySelector('use')!.getAttribute('href')).toBe('assets/ui-icons.svg#flag');
    expect(fixture.componentInstance.icon.pristine).toBeTrue();
  });

  it('shows the real icon in every choice and the selected value without affecting the type', () => {
    const fixture = TestBed.createComponent(IconTestHost);
    fixture.detectChanges();
    const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('#mapIcon');
    trigger.click();
    fixture.detectChanges();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const options = Array.from(overlay.querySelectorAll<HTMLElement>('[role="option"]'));
    options.forEach(option => expect(option.querySelector('svg use')).not.toBeNull());
    options.find(option => option.textContent?.trim() === 'Crown')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.icon.value).toBe('crown');
    expect(fixture.componentInstance.icon.dirty).toBeTrue();
    expect(fixture.componentInstance.type.value).toBe('settlement');
    expect(trigger.querySelector('use')!.getAttribute('href')).toBe('assets/ui-icons.svg#crown');
    expect(trigger.textContent).toContain('Crown');
    fixture.componentInstance.type.setValue('country');
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(trigger.querySelector('use')!.getAttribute('href')).toBe('assets/ui-icons.svg#crown');
    fixture.componentInstance.icon.disable();
    fixture.detectChanges();
    expect(trigger.disabled).toBeTrue();
  });

  it('keeps listbox and keyboard focus IDs independent for type and icon controls', () => {
    const fixture = TestBed.createComponent(IconTestHost);
    fixture.detectChanges();
    const triggers = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    triggers[0].click();
    fixture.detectChanges();
    const typeId = triggers[0].getAttribute('aria-controls');
    triggers[1].click();
    fixture.detectChanges();
    expect(triggers[1].getAttribute('aria-controls')).not.toBe(typeId);
    const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    triggers[1].dispatchEvent(event);
    fixture.detectChanges();
    const activeId = triggers[1].getAttribute('aria-activedescendant')!;
    expect(document.getElementById(activeId)?.textContent).toContain('Book');
    triggers[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.icon.value).toBe('book-open');
  });
});
