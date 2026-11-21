import { CharacterValidator } from './character.validator';
import { Character } from '../interfaces/character.interface';
import { ProjectMetadata } from '../interfaces/project.interface';

describe('CharacterValidator', () => {
  describe('validateAgainstMetadata', () => {
    const createValidMetadata = (): ProjectMetadata => ({
      projectName: 'Test Project',
      version: '1.0.0',
      categories: [
        { id: 'main-character', name: 'Main Character', color: '#FF0000' },
        { id: 'supporting', name: 'Supporting', color: '#00FF00' }
      ],
      tags: [
        { id: 'magic-user', name: 'Magic User', color: '#0000FF' },
        { id: 'warrior', name: 'Warrior', color: '#FFFF00' }
      ],
      casts: [],
      books: [],
      settings: {
        defaultCategory: 'main-character'
      }
    });

    const createValidCharacter = (): Character => ({
      id: '_test-character.md',
      name: 'Test Character',
      category: 'main-character',
      tags: ['magic-user'],
      books: [],
      prompts: [],
      content: '',
      created: new Date(),
      modified: new Date(),
      relativePath: '_test-character.md',
      filePath: '/path/to/character/_test-character.md',
    });

    it('should validate character with valid category and tags', () => {
      const character = createValidCharacter();
      const metadata = createValidMetadata();
      const result = CharacterValidator.validateAgainstMetadata(character, metadata);
      
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should fail validation when category does not exist in metadata', () => {
      const character = createValidCharacter();
      character.category = 'non-existent-category';
      const metadata = createValidMetadata();
      const result = CharacterValidator.validateAgainstMetadata(character, metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'category' && e.code === 'INVALID_REFERENCE')).toBe(true);
    });

    it('should fail validation when tag does not exist in metadata', () => {
      const character = createValidCharacter();
      character.tags = ['non-existent-tag'];
      const metadata = createValidMetadata();
      const result = CharacterValidator.validateAgainstMetadata(character, metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'tags' && e.code === 'INVALID_REFERENCE')).toBe(true);
    });

    it('should fail validation when multiple tags do not exist', () => {
      const character = createValidCharacter();
      character.tags = ['magic-user', 'non-existent-tag-1', 'non-existent-tag-2'];
      const metadata = createValidMetadata();
      const result = CharacterValidator.validateAgainstMetadata(character, metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.filter(e => e.field === 'tags' && e.code === 'INVALID_REFERENCE').length).toBe(2);
    });

    it('should pass validation with empty tags array', () => {
      const character = createValidCharacter();
      character.tags = [];
      const metadata = createValidMetadata();
      const result = CharacterValidator.validateAgainstMetadata(character, metadata);
      
      expect(result.isValid).toBe(true);
    });

    it('should validate bookCategories against metadata and assigned books', () => {
      const character = createValidCharacter();
      const metadata = createValidMetadata();
      metadata.books = [
        { id: 'book-1', name: 'Book 1', color: '#111' },
        { id: 'book-2', name: 'Book 2', color: '#222' },
      ];
      character.books = ['book-1', 'book-2'];
      character.bookCategories = { 'book-2': 'supporting' };

      const result = CharacterValidator.validateAgainstMetadata(character, metadata);
      expect(result.isValid).toBe(true);
    });

    it('should fail when bookCategories references an unknown category', () => {
      const character = createValidCharacter();
      const metadata = createValidMetadata();
      metadata.books = [{ id: 'book-1', name: 'Book 1', color: '#111' }];
      character.books = ['book-1'];
      character.bookCategories = { 'book-1': 'not-a-category' };

      const result = CharacterValidator.validateAgainstMetadata(character, metadata);
      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.field === 'bookCategories' && e.code === 'INVALID_REFERENCE')
      ).toBe(true);
    });

    it('should fail when bookCategories references a book not assigned to the character', () => {
      const character = createValidCharacter();
      const metadata = createValidMetadata();
      metadata.books = [
        { id: 'book-1', name: 'Book 1', color: '#111' },
        { id: 'book-2', name: 'Book 2', color: '#222' },
      ];
      character.books = ['book-1'];
      character.bookCategories = { 'book-2': 'supporting' };

      const result = CharacterValidator.validateAgainstMetadata(character, metadata);
      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.field === 'bookCategories' && e.code === 'INVALID_REFERENCE')
      ).toBe(true);
    });
  });
});
