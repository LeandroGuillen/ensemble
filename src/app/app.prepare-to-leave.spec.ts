import { AppComponent } from './app.component';
import { BookPlanService } from './core/services/book-plan.service';

describe('AppComponent prepare-to-leave IPC bridge', () => {
  let component: AppComponent;
  let electronService: {
    replyPrepareToLeaveAck: jasmine.Spy;
    replyPrepareToLeaveResult: jasmine.Spy;
  };
  let bookPlan: { prepareToLeave: jasmine.Spy };
  let injector: { get: jasmine.Spy };
  let logger: { error: jasmine.Spy };

  beforeEach(() => {
    electronService = {
      replyPrepareToLeaveAck: jasmine.createSpy('replyPrepareToLeaveAck'),
      replyPrepareToLeaveResult: jasmine.createSpy('replyPrepareToLeaveResult'),
    };
    bookPlan = {
      prepareToLeave: jasmine.createSpy('prepareToLeave').and.resolveTo(true),
    };
    injector = {
      get: jasmine.createSpy('get').and.callFake((token: unknown) => {
        if (token === BookPlanService) {
          return bookPlan;
        }
        throw new Error('unexpected token');
      }),
    };
    logger = { error: jasmine.createSpy('error') };

    component = Object.create(AppComponent.prototype);
    (component as any).electronService = electronService;
    (component as any).injector = injector;
    (component as any).logger = logger;
  });

  it('acks, runs prepareToLeave, and replies with the result', async () => {
    bookPlan.prepareToLeave.and.resolveTo(false);

    await (component as any).handlePrepareToLeaveRequest();

    expect(electronService.replyPrepareToLeaveAck).toHaveBeenCalled();
    expect(bookPlan.prepareToLeave).toHaveBeenCalled();
    expect(electronService.replyPrepareToLeaveResult).toHaveBeenCalledWith(false);
  });

  it('fail-opens when prepareToLeave throws so quit is not stuck', async () => {
    bookPlan.prepareToLeave.and.rejectWith(new Error('boom'));

    await (component as any).handlePrepareToLeaveRequest();

    expect(electronService.replyPrepareToLeaveAck).toHaveBeenCalled();
    expect(electronService.replyPrepareToLeaveResult).toHaveBeenCalledWith(true);
    expect(logger.error).toHaveBeenCalled();
  });
});
