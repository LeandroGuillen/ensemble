import { buildCharacterDeleteMessage, CharacterDeleteMessageDeps } from './character-delete-message.utils';

describe('Character Delete Message Utils', () => {
  let mockCharacterService: jasmine.SpyObj<any>;
  let mockLogger: jasmine.SpyObj<any>;
  let deps: CharacterDeleteMessageDeps;

  beforeEach(() => {
    mockCharacterService = jasmine.createSpyObj('CharacterService', ['countCharacterReferences']);
    mockLogger = jasmine.createSpyObj('Logger', ['error']);
    deps = {
      characterService: mockCharacterService,
      logger: mockLogger
    };
  });

  describe('buildCharacterDeleteMessage', () => {
    it('should build message with reference details when count succeeds', async () => {
      mockCharacterService.countCharacterReferences.and.returnValue(Promise.resolve({
        houses: [{ id: 'h1', name: 'House Stark' }],
        casts: [{ id: 'c1', name: 'Main Cast' }],
        pinboards: [],
        plotBoards: []
      }));

      const message = await buildCharacterDeleteMessage(
        'Jon Snow',
        'char-1',
        false,
        deps
      );

      expect(message).toContain('Are you sure you want to delete "Jon Snow"?');
      expect(message).toContain('This character will be removed from:');
      expect(message).toContain('1 house: House Stark');
      expect(message).toContain('1 cast: Main Cast');
      expect(message).toContain('It will be moved to the system Trash. You can undo for 15 seconds.');
    });

    it('should still show confirmation dialog when counting references fails', async () => {
      mockCharacterService.countCharacterReferences.and.returnValue(
        Promise.reject(new Error('Service error'))
      );

      const message = await buildCharacterDeleteMessage(
        'Jon Snow',
        'char-1',
        false,
        deps
      );

      // Should return base message without crashing
      expect(message).toContain('Are you sure you want to delete "Jon Snow"?');
      expect(message).toContain('It will be moved to the system Trash. You can undo for 15 seconds.');
      
      // Should NOT contain reference details
      expect(message).not.toContain('This character will be removed from:');
      
      // Should have logged the error
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to count character references',
        jasmine.any(Error)
      );
    });

    it('lists the prompts that link a draft', async () => {
      mockCharacterService.countCharacterReferences.and.returnValue(Promise.resolve({
        houses: [],
        casts: [],
        pinboards: [],
        plotBoards: [],
        prompts: [{ id: 'characters/Draft Character.md', name: 'Draft Character' }],
      }));

      const message = await buildCharacterDeleteMessage(
        'Draft Character',
        'draft-1',
        true,
        deps
      );

      expect(message).toContain('Are you sure you want to delete "Draft Character"?');
      expect(message).toContain('This draft will be removed from:\n• 1 prompt: Draft Character');
      expect(message).toContain('It will be moved to the system Trash. You can undo for 15 seconds.');
      expect(mockCharacterService.countCharacterReferences).toHaveBeenCalledWith('draft-1');
    });

    it('lists linked prompts and says prompt links come back only with Undo', async () => {
      mockCharacterService.countCharacterReferences.and.returnValue(Promise.resolve({
        houses: [{ id: 'h1', name: 'House Vell' }],
        casts: [],
        pinboards: [],
        plotBoards: [],
        prompts: [
          { id: 'characters/Mara Vell.md', name: 'Mara Vell' },
          { id: 'portraits/Mara young.md', name: 'Mara young' },
        ],
      }));

      const message = await buildCharacterDeleteMessage('Mara Vell', 'mara-vell', false, deps);

      expect(message).toContain('This character will be removed from:');
      expect(message).toContain('• 2 prompts: Mara Vell, Mara young');
      expect(message).toContain('plot threads and prompts come back only with Undo');
    });

    it('should handle unnamed characters', async () => {
      mockCharacterService.countCharacterReferences.and.returnValue(Promise.resolve({
        houses: [],
        casts: [],
        pinboards: [],
        plotBoards: []
      }));

      const message = await buildCharacterDeleteMessage(
        '',
        'char-1',
        false,
        deps
      );

      expect(message).toContain('Are you sure you want to delete "Unnamed draft"?');
    });

    it('should not include references section when character has no references', async () => {
      mockCharacterService.countCharacterReferences.and.returnValue(Promise.resolve({
        houses: [],
        casts: [],
        pinboards: [],
        plotBoards: []
      }));

      const message = await buildCharacterDeleteMessage(
        'Orphan Character',
        'char-1',
        false,
        deps
      );

      expect(message).toContain('Are you sure you want to delete "Orphan Character"?');
      expect(message).not.toContain('This character will be removed from:');
      expect(message).toContain('It will be moved to the system Trash. You can undo for 15 seconds.');
    });

    it('should handle count rejection and still produce valid message', async () => {
      mockCharacterService.countCharacterReferences.and.returnValue(
        Promise.reject({ message: 'Network timeout' })
      );

      const message = await buildCharacterDeleteMessage(
        'Test Character',
        'char-1',
        false,
        deps
      );

      // Function should not throw
      expect(message).toBeTruthy();
      expect(message).toContain('Test Character');
      expect(message).toContain('It will be moved to the system Trash. You can undo for 15 seconds.');
      
      // Error should be logged
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
