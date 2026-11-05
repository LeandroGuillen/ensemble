import { TestBed } from '@angular/core/testing';
import { ConfirmationRequest, ModalService } from './modal.service';

describe('ModalService sequential confirm', () => {
  let modal: ModalService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ModalService],
    });
    modal = TestBed.inject(ModalService);
  });

  it('does not emit the second dialog until the first promise settles', async () => {
    const shown: string[] = [];
    let active: ConfirmationRequest | undefined;
    modal.confirmation$.subscribe((r) => {
      shown.push(r.message);
      active = r;
    });

    const first = modal.confirm('first message');
    await Promise.resolve();
    expect(shown).toEqual(['first message']);

    const second = modal.confirm('second message');
    await Promise.resolve();
    expect(shown).toEqual(['first message']);

    active!.resolve(true);
    expect(await first).toBeTrue();
    await Promise.resolve();
    expect(shown).toEqual(['first message', 'second message']);

    active!.resolve(false);
    expect(await second).toBeFalse();
  });
});
