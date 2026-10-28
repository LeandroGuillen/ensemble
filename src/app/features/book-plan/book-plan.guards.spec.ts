import { BookPlanComponent } from './book-plan.component';
import { bookPlanEditorGuard } from '../../core/guards/book-plan-editor.guard';

describe('BookPlanComponent leave guards', () => {
  let component: BookPlanComponent;
  let bookPlan: {
    prepareToLeave: jasmine.Spy;
    hasPendingWork: jasmine.Spy;
  };

  beforeEach(() => {
    bookPlan = {
      prepareToLeave: jasmine.createSpy('prepareToLeave').and.returnValue(true),
      hasPendingWork: jasmine.createSpy('hasPendingWork').and.returnValue(false),
    };
    component = Object.create(BookPlanComponent.prototype);
    (component as any).bookPlan = bookPlan;
  });

  it('canLeave delegates to BookPlanService.prepareToLeave', async () => {
    bookPlan.prepareToLeave.and.resolveTo(true);
    expect(await component.canLeave()).toBeTrue();
    expect(bookPlan.prepareToLeave).toHaveBeenCalled();
  });

  it('canLeave respects a cancelled conflict prompt', async () => {
    bookPlan.prepareToLeave.and.resolveTo(false);
    expect(await component.canLeave()).toBeFalse();
  });

  it('bookPlanEditorGuard calls component.canLeave', async () => {
    bookPlan.prepareToLeave.and.resolveTo(true);
    const result = await bookPlanEditorGuard(component as any, {} as any, {} as any, {} as any);
    expect(result).toBeTrue();
    expect(bookPlan.prepareToLeave).toHaveBeenCalled();
  });

  it('prevents window close when there is pending work', () => {
    bookPlan.hasPendingWork.and.returnValue(true);
    const event = { preventDefault: jasmine.createSpy('preventDefault') } as any;
    component.beforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('allows window close when there is no pending work', () => {
    bookPlan.hasPendingWork.and.returnValue(false);
    const event = { preventDefault: jasmine.createSpy('preventDefault') } as any;
    component.beforeUnload(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('never uses the native confirm (it breaks keyboard focus in Electron)', async () => {
    const native = spyOn(window, 'confirm');
    bookPlan.prepareToLeave.and.resolveTo(true);
    await component.canLeave();
    expect(native).not.toHaveBeenCalled();
  });
});
