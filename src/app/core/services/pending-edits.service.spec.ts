import { PendingEditsService } from './pending-edits.service';

describe('PendingEditsService', () => {
  let service: PendingEditsService;

  beforeEach(() => {
    service = new PendingEditsService();
  });

  it('flushAll runs registered flushers and stops after unregister', async () => {
    const flush = jasmine.createSpy('flush').and.resolveTo();
    const unregister = service.register(flush);

    await service.flushAll();
    expect(flush).toHaveBeenCalledTimes(1);

    unregister();
    await service.flushAll();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('flushAll waits for tracked saves and still resolves when one fails', async () => {
    let finish!: () => void;
    let flushed = false;
    service.track(new Promise<void>((resolve) => (finish = resolve)));
    service.track(Promise.reject(new Error('disk full')));
    service.register(() => Promise.reject(new Error('also failed')));

    const done = service.flushAll().then(() => (flushed = true));
    await new Promise((resolve) => setTimeout(resolve));
    expect(flushed).toBeFalse();

    finish();
    await done;
    expect(flushed).toBeTrue();
  });
});
