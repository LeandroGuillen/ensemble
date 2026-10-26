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
      router,
      modalService: modal,
    });
  });

  it('opens a missing character creation route', async () => {
    await component.openDescriptionLink('#/character?name=New%20Friend&fromLink=1');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/character?name=New%20Friend&fromLink=1');
    expect(modal.confirm).not.toHaveBeenCalled();
  });

  it('routes character, House and location links through the router (the leave guard confirms)', async () => {
    component.characterForm.markAsDirty();
    for (const href of ['#/character/ben', '#/house/house-id', '#/location/location-id', '#/house?name=New&fromLink=1']) {
      await component.openDescriptionLink(href);
      expect(router.navigateByUrl).toHaveBeenCalledWith(href.slice(1));
    }
    expect(modal.confirm).not.toHaveBeenCalled();
  });

  it('stays on the page for self links and ignores other hrefs', async () => {
    await component.openDescriptionLink('#/character/ada');
    await component.openDescriptionLink('https://example.com');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
