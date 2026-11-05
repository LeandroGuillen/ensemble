import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { CommandPaletteComponent } from './command-palette.component';
import { CommandPaletteService } from './command-palette.service';

describe('CommandPaletteComponent accessibility', () => {
  let fixture: ComponentFixture<CommandPaletteComponent>;
  let service: CommandPaletteService;
  let opener: HTMLButtonElement;
  const ran: string[] = [];

  /** State changes from services/events are outside the zoneless test's knowledge. */
  const render = () => {
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  };

  const key = (k: string) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    render();
    return event;
  };

  beforeEach(async () => {
    ran.length = 0;
    await TestBed.configureTestingModule({ imports: [CommandPaletteComponent] }).compileComponents();
    service = TestBed.inject(CommandPaletteService);
    service.registerCommands([
      { id: 'a', label: 'Mara Vell', action: () => ran.push('a') },
      { id: 'b', label: 'Mara Vell (Lore)', action: () => ran.push('b') },
      { id: 'c', label: 'Oren Vell', action: () => ran.push('c') },
    ]);
    fixture = TestBed.createComponent(CommandPaletteComponent);
    fixture.detectChanges();

    opener = document.createElement('button');
    opener.textContent = 'Search';
    document.body.appendChild(opener);
  });

  afterEach(() => {
    service.close();
    opener.remove();
  });

  it('is a modal dialog with a labelled combobox that owns a listbox of options', fakeAsync(() => {
    opener.focus();
    service.open();
    render();
    tick();

    const root: HTMLElement = fixture.nativeElement;
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBeTruthy();

    const input = root.querySelector('input[role="combobox"]') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBeTruthy();
    expect(document.activeElement).toBe(input);

    const listbox = root.querySelector('[role="listbox"]')!;
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(input.getAttribute('aria-expanded')).toBe('true');

    const options = Array.from(root.querySelectorAll('[role="option"]'));
    expect(options.length).toBe(3);
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    flush();
  }));

  it('moves the active option with the arrows, announces the count, keeps Tab inside and returns focus on Escape', fakeAsync(() => {
    opener.focus();
    service.open();
    render();
    tick();

    const root: HTMLElement = fixture.nativeElement;
    const input = root.querySelector('input[role="combobox"]') as HTMLInputElement;
    input.value = 'mara';
    input.dispatchEvent(new Event('input'));
    render();
    expect(root.querySelector('[role="status"]')!.textContent!.trim()).toBe('2 results');

    expect(key('ArrowDown').defaultPrevented).toBeTrue();
    const options = Array.from(root.querySelectorAll('[role="option"]'));
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(options[0].getAttribute('aria-selected')).toBe('false');

    expect(key('Tab').defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(input);

    key('Escape');
    tick();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    flush();
  }));

  it('runs the active option on Enter', fakeAsync(() => {
    service.open();
    render();
    tick();
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    tick();
    expect(ran).toEqual(['c']);
    flush();
  }));
});
