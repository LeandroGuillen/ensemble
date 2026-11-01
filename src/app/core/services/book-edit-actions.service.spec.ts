import { TestBed } from '@angular/core/testing';
import { BookEditActionsService, BookFormData } from './book-edit-actions.service';
import { MetadataService } from './metadata.service';
import { ModalService } from './modal.service';
import { CharacterService } from './character.service';
import { Book } from '../interfaces/project.interface';

describe('BookEditActionsService book code change', () => {
  let service: BookEditActionsService;
  let metadata: jasmine.SpyObj<MetadataService>;
  let characters: jasmine.SpyObj<CharacterService>;
  const moves = [{ from: '/c/ilse/ilse.lc2.md', to: '/c/ilse/ilse.tb.md', name: 'Ilse' }];

  const book: Book = { id: 'tidebreak', code: 'lc2', name: 'Tidebreak', color: '#111' };
  const form = (code?: string): BookFormData => ({ name: 'Tidebreak', code, color: '#111' });

  beforeEach(() => {
    metadata = jasmine.createSpyObj('MetadataService', ['addBook', 'updateBook', 'moveBook', 'removeBook']);
    metadata.updateBook.and.callFake(async (id: string, updates: any) => ({ ...book, ...updates, id }));
    characters = jasmine.createSpyObj('CharacterService', [
      'planBookPageRename',
      'applyBookPageRename',
      'undoBookPageRename',
    ]);
    characters.planBookPageRename.and.returnValue(Promise.resolve(moves));
    characters.applyBookPageRename.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        BookEditActionsService,
        { provide: MetadataService, useValue: metadata },
        { provide: ModalService, useValue: jasmine.createSpyObj('ModalService', ['confirm']) },
        { provide: CharacterService, useValue: characters },
      ],
    });
    service = TestBed.inject(BookEditActionsService);
  });

  it('renames character pages from the old code to the new code after saving', async () => {
    await service.save(book, form('tb'));
    expect(characters.planBookPageRename).toHaveBeenCalledWith('lc2', 'tb');
    expect(metadata.updateBook).toHaveBeenCalledTimes(1);
    expect(characters.applyBookPageRename).toHaveBeenCalledWith(moves);
  });

  it('clearing the code renames to the id-based suffix', async () => {
    await service.save(book, form(''));
    expect(characters.planBookPageRename).toHaveBeenCalledWith('lc2', 'tidebreak');
  });

  it('setting a code on a book that had none renames from the id-based suffix', async () => {
    await service.save({ ...book, code: undefined }, form('tb'));
    expect(characters.planBookPageRename).toHaveBeenCalledWith('tidebreak', 'tb');
  });

  it('does nothing to pages when the code is unchanged (or changes only in case)', async () => {
    await service.save(book, form('LC2'));
    expect(characters.planBookPageRename).not.toHaveBeenCalled();
    expect(characters.applyBookPageRename).not.toHaveBeenCalled();
  });

  it('a refused preflight saves nothing', async () => {
    characters.planBookPageRename.and.returnValue(Promise.reject(new Error('already have notes')));
    await expectAsync(service.save(book, form('tb'))).toBeRejectedWithError(/already have notes/);
    expect(metadata.updateBook).not.toHaveBeenCalled();
  });

  it('a refused metadata save renames nothing', async () => {
    metadata.updateBook.and.returnValue(Promise.reject(new Error('Invalid book')));
    await expectAsync(service.save(book, form('tb'))).toBeRejectedWithError(/Invalid book/);
    expect(characters.applyBookPageRename).not.toHaveBeenCalled();
  });

  it('a failed rename restores the previous book code and reports it', async () => {
    characters.applyBookPageRename.and.returnValue(Promise.reject(new Error("Couldn't rename the notes of \"Ilse\"")));
    await expectAsync(service.save(book, form('tb'))).toBeRejectedWithError(/Ilse.*The book was not changed/);
    expect(metadata.updateBook).toHaveBeenCalledTimes(2);
    expect(metadata.updateBook.calls.mostRecent().args).toEqual([
      'tidebreak',
      jasmine.objectContaining({ code: 'lc2', name: 'Tidebreak' }),
    ]);
  });
});
