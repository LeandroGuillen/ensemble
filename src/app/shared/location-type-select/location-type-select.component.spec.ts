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
});
