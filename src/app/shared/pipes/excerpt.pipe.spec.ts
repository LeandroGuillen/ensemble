import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { ChangeDetectorRef } from '@angular/core';
import { ExcerptPipe, WikiTextPipe } from './excerpt.pipe';
import { WikiLinkTargetsService } from '../../core/services/wiki-link-targets.service';
import { WikiLinkRecordName, buildWikiLinkTargets } from '../../core/utils/wiki-links.utils';

describe('ExcerptPipe / WikiTextPipe wiki link display', () => {
  const records = buildWikiLinkTargets([{
    folder: 'characters', route: 'character', singular: 'Character',
    targets: [
      { id: 'c', name: 'C#', relativePath: 'c/c.md' },
      { id: 'u', name: 'Unit#7', relativePath: 'unit-7/unit-7.md' },
    ],
  }]).recordName;
  let recordName$: BehaviorSubject<WikiLinkRecordName>;
  let markForCheck: jasmine.Spy;

  beforeEach(() => {
    recordName$ = new BehaviorSubject<WikiLinkRecordName>(records);
    markForCheck = jasmine.createSpy('markForCheck');
    TestBed.configureTestingModule({
      providers: [
        ExcerptPipe,
        WikiTextPipe,
        { provide: WikiLinkTargetsService, useValue: { recordName$: () => recordName$ } },
        { provide: ChangeDetectorRef, useValue: { markForCheck } },
      ],
    });
  });

  const body = 'Met [[Unit #7]] at the docks; not \\[[Literal]].';
  const probe = 'Wrote [[C#]] tools for [[Unit#7]].';

  it('character card and list previews keep # names and escaped links', () => {
    expect(TestBed.inject(ExcerptPipe).transform(body, 150)).toBe('Met Unit #7 at the docks; not \\[[Literal]].');
  });

  it('plot-board beats keep # names and escaped links', () => {
    expect(TestBed.inject(WikiTextPipe).transform(body)).toBe('Met Unit #7 at the docks; not \\[[Literal]].');
  });

  it('card, list and plot beat previews show C# and Unit#7 records unchopped', () => {
    expect(TestBed.inject(ExcerptPipe).transform(probe, 150)).toBe('Wrote C# tools for Unit#7.');
    expect(TestBed.inject(WikiTextPipe).transform(probe)).toBe('Wrote C# tools for Unit#7.');
  });

  it('updates when the project records change', () => {
    const pipe = TestBed.inject(WikiTextPipe);
    recordName$.next(() => undefined);
    expect(pipe.transform('[[Unit#7]]')).toBe('Unit');
    recordName$.next(records);
    expect(markForCheck).toHaveBeenCalled();
    expect(pipe.transform('[[Unit#7]]')).toBe('Unit#7');
    pipe.ngOnDestroy();
    expect(recordName$.observed).toBeFalse();
  });
});
