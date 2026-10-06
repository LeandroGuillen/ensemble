import { FormBuilder } from '@angular/forms';
import { CharacterDetailComponent } from './character-detail.component';

describe('Character description links', () => {
  let component: CharacterDetailComponent;
  let router: jasmine.SpyObj<any>;
  let modal: jasmine.SpyObj<any>;

  beforeEach(() => {
    component = Object.create(CharacterDetailComponent.prototype);
    router = jasmine.createSpyObj('Router', ['navigateByUrl']);
    router.navigateByUrl.and.resolveTo(true);
    modal = jasmine.createSpyObj('ModalService', ['confirm']);
    modal.confirm.and.resolveTo(true);
    Object.assign(component, {
      character: { id: 'ada' },
      characterForm: new FormBuilder().group({ content: ['[[Ben]]'] }),
      bookPageData: { book: { exists: true, content: '[[Missing|a friend]]' } },
      bookPageOriginalContent: { book: '[[Missing|a friend]]' },
      linkCharacters: [{ id: 'ben', name: 'Ben', relativePath: 'ben/ben.md' }],
      descriptionPreviews: new Map(),
      otherLinkCollections: [],
      router,
      modalService: modal,
    });
  });

  function click(href: string): MouseEvent {
    const anchor = document.createElement('a');
    anchor.setAttribute('href', href);
    const label = document.createElement('span');
    anchor.append(label);
    return { target: label, preventDefault: jasmine.createSpy('preventDefault') } as any;
  }

  it('renders main and book page content and updates previews after edits', () => {
    expect(component.getDescriptionPreview('main').html).toContain('#/character/ben');
    expect(component.getDescriptionPreview('book').missingLinks).toEqual(['Missing']);
    component.setBookPageContent('book', '[[Ben|a friend]]');
    expect(component.getDescriptionPreview('book').html).toContain('>a friend</a>');
    expect(component.getDescriptionPreview('book').missingLinks).toEqual([]);
  });

  it('opens a missing character creation route', async () => {
    await component.onDescriptionLinkClick(click('#/character?name=New%20Friend&fromLink=1'));
    expect(router.navigateByUrl).toHaveBeenCalledWith('/character?name=New%20Friend&fromLink=1');
    expect(modal.confirm).not.toHaveBeenCalled();
  });

  it('routes House and location links through the unsaved-change prompt', async () => {
    component.characterForm.markAsDirty();
    for (const href of ['#/house/house-id', '#/location/location-id', '#/house?name=New&fromLink=1']) {
      await component.onDescriptionLinkClick(click(href));
      expect(router.navigateByUrl).toHaveBeenCalledWith(href.slice(1));
    }
    expect(modal.confirm).toHaveBeenCalledTimes(3);
  });

  it('refreshes previews when House or location data is loaded', () => {
    component.characterForm.patchValue({ content: '[[houses/bulanco/bulanco]]' });
    expect(component.getDescriptionPreview('main').missingLinks.length).toBe(1);
    (component as any).otherLinkCollections = [{
      targets: [{ id: 'house-id', name: 'Bulanco', relativePath: 'bulanco/bulanco.md' }],
      folder: 'houses', route: 'house', singular: 'House',
    }];
    expect(component.getDescriptionPreview('main').html).toContain('#/house/house-id');
    expect(component.getDescriptionPreview('main').missingLinks).toEqual([]);
  });

  it('keeps unsaved book edits when discarding is declined', async () => {
    component.setBookPageContent('book', 'unsaved');
    modal.confirm.and.resolveTo(false);
    await component.onDescriptionLinkClick(click('#/character/ben'));
    expect(modal.confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('asks before leaving unsaved main edits and allows confirmed navigation', async () => {
    component.characterForm.markAsDirty();
    await component.onDescriptionLinkClick(click('#/character/ben'));
    expect(modal.confirm).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/character/ben');
  });

  it('stays on the page for self links and leaves external links alone', async () => {
    const self = click('#/character/ada');
    await component.onDescriptionLinkClick(self);
    expect(self.preventDefault).toHaveBeenCalled();
    const external = click('https://example.com');
    await component.onDescriptionLinkClick(external);
    expect(external.preventDefault).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
