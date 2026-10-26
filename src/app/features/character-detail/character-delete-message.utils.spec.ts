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
      expect(message).toContain('This action cannot be undone.');
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
      expect(message).toContain('This action cannot be undone.');
      
      // Should NOT contain reference details
      expect(message).not.toContain('This character will be removed from:');
      
      // Should have logged the error
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to count character references',
        jasmine.any(Error)
      );
    });

    it('should skip reference counting for drafts', async () => {
      const message = await buildCharacterDeleteMessage(
        'Draft Character',
        'draft-1',
        true,
        deps
      );

      expect(message).toContain('Are you sure you want to delete "Draft Character"?');
      expect(message).toContain('This action cannot be undone.');
      
      // Should not have called countCharacterReferences
      expect(mockCharacterService.countCharacterReferences).not.toHaveBeenCalled();
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
      expect(message).toContain('This action cannot be undone.');
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
      expect(message).toContain('This action cannot be undone.');
      
      // Error should be logged
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
