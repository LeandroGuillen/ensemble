import { TestBed } from '@angular/core/testing';
import { ThreadToolbarComponent } from './thread-toolbar.component';
import { ThreadToolbarService } from './thread-toolbar.service';

describe('ThreadToolbarComponent keyboard and delete', () => {
  const setup = async () => {
    await TestBed.configureTestingModule({
      imports: [ThreadToolbarComponent],
      providers: [ThreadToolbarService],
    }).compileComponents();
    const fixture = TestBed.createComponent(ThreadToolbarComponent);
    fixture.componentRef.setInput('threads', [{ id: 't1', name: 'The failing light', characters: [] }]);
    const service = TestBed.inject(ThreadToolbarService);
    service.activeThreadId = 't1';
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, service, root: fixture.nativeElement as HTMLElement };
  };

  it('names every action and routes Delete to the board (shared dialog) instead of deleting inline', async () => {
    const { component, root } = await setup();
    const labels = Array.from(root.querySelectorAll('.thread-hover-toolbar button')).map(b => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Color for thread The failing light', 'Link a character to The failing light', 'Delete thread The failing light']);

    const requested: string[] = [];
    const deleted: string[] = [];
    component.deleteRequested.subscribe(id => requested.push(id));
    component.confirmDelete.subscribe(id => deleted.push(id));
    (root.querySelector('[aria-label="Delete thread The failing light"]') as HTMLButtonElement).click();
    expect(requested).toEqual(['t1']);
    expect(deleted).toEqual([]);
  });

  it('stays visible while focus moves inside it and hides after focus leaves', async () => {
    jasmine.clock().install();
    try {
      const { component, service, root } = await setup();
      const toolbar = root.querySelector('.thread-hover-toolbar') as HTMLElement;
      const [first, second] = Array.from(toolbar.querySelectorAll('button')) as HTMLButtonElement[];

      component.onToolbarFocusOut('t1', { relatedTarget: second, currentTarget: toolbar } as unknown as FocusEvent);
      jasmine.clock().tick(300);
      expect(component.isVisible('t1')).toBeTrue();

      component.onToolbarFocusOut('t1', { relatedTarget: document.body, currentTarget: toolbar } as unknown as FocusEvent);
      jasmine.clock().tick(300);
      expect(service.activeThreadId).toBeNull();
      expect(first).toBeTruthy();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('Escape returns focus to the owning thread name', async () => {
    const { component } = await setup();
    const name = document.createElement('span');
    name.className = 'thread-name';
    name.dataset['threadId'] = 't1';
    name.tabIndex = 0;
    document.body.appendChild(name);
    try {
      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      component.onToolbarEscape('t1', event);
      expect(event.defaultPrevented).toBeTrue();
      expect(document.activeElement).toBe(name);
    } finally {
      name.remove();
    }
  });
});
