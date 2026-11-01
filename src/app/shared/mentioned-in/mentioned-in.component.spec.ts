import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { MentionedInComponent } from './mentioned-in.component';
import { BacklinkService } from '../../core/services/backlink.service';
import { BacklinkIndex } from '../../core/utils/backlinks.utils';

describe('MentionedInComponent', () => {
  let fixture: ComponentFixture<MentionedInComponent>;
  let indexSubject: BehaviorSubject<BacklinkIndex>;
  let excludedCountSpy: jasmine.Spy;

  beforeEach(async () => {
    indexSubject = new BehaviorSubject<BacklinkIndex>({ byTargetId: {}, excluded: [] });
    excludedCountSpy = jasmine.createSpy('excludedCountFor').and.returnValue(0);
    const backlinkService = {
      index$: indexSubject.asObservable(),
      backlinksFor: (id: string) => indexSubject.value.byTargetId[id] || [],
      excludedCountFor: excludedCountSpy,
    };

    await TestBed.configureTestingModule({
      imports: [MentionedInComponent],
      providers: [{ provide: BacklinkService, useValue: backlinkService }, provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(MentionedInComponent);
    fixture.componentInstance.targetId = 'c-mara';
    fixture.componentInstance.targetName = 'Mara Vell';
    fixture.componentInstance.targetAliases = ['The Keeper'];
  });

  it('shows nothing when there are no mentions or excluded links', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mentioned-in')).toBeNull();
  });

  it('renders grouped backlinks with a snippet and a navigation link', () => {
    indexSubject.next({
      byTargetId: {
        'c-mara': [
          {
            sourceType: 'character',
            sourceId: 'c-oren',
            sourceName: 'Oren Vell',
            href: '#/character/c-oren',
            snippet: '…[Mara Vell] lights the beacon…',
          },
        ],
      },
      excluded: [],
    });
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.mentioned-in') as HTMLElement;
    expect(el.textContent).toContain('Mentioned in (1)');
    expect(el.textContent).toContain('Characters');
    expect(el.textContent).toContain('Oren Vell');
    expect(el.textContent).toContain('lights the beacon');
    const anchor = el.querySelector('a') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toContain('/character/c-oren');
  });

  it('shows the excluded (unresolved) count note', () => {
    excludedCountSpy.and.returnValue(1);
    indexSubject.next({ byTargetId: { 'c-mara': [] }, excluded: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('couldn’t be resolved');
    expect(fixture.nativeElement.textContent).toContain('Mara Vell');
  });

  it('routes a book plan source to the book and a book page to its character', () => {
    const plan = fixture.componentInstance.routerLinkFor({
      sourceType: 'book', sourceId: 'b-lc1', sourceName: 'LC1', sourcePart: 'Book plan', href: '', snippet: '',
    });
    const page = fixture.componentInstance.routerLinkFor({
      sourceType: 'book', sourceId: 'c-mara', sourceName: 'Mara Vell', sourcePart: 'Book page: lc1', href: '', snippet: '',
    });
    expect(plan).toEqual(['/book', 'b-lc1']);
    expect(page).toEqual(['/character', 'c-mara']);
  });
});
