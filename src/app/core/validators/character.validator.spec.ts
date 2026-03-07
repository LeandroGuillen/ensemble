import { CharacterValidator } from './character.validator';
import { Character, CharacterFormData } from '../interfaces/character.interface';
import { ProjectMetadata } from '../interfaces/project.interface';

describe('CharacterValidator', () => {
  describe('validateCharacter', () => {
    const createValidCharacter = (): Character => ({
      id: '_test-character.md',
      name: 'Test Character',
      category: 'main-character',
      tags: ['magic-user'],
      books: [],
      content: 'Test content',
      created: new Date('2024-01-01'),
      modified: new Date('2024-01-02'),
      filePath: '/path/to/character/_test-character.md',
    });

    it('should validate a valid character', () => {
      const character = createValidCharacter();
      const result = CharacterValidator.validateCharacter(character);
      
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should fail validation when name is missing', () => {
      const character = createValidCharacter();
      character.name = '';
      const result = CharacterValidator.validateCharacter(character);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].field).toBe('name');
      expect(result.errors[0].code).toBe('REQUIRED_FIELD');
    });

    it('should fail validation when name is only whitespace', () => {
      const character = createValidCharacter();
      character.name = '   ';
      const result = CharacterValidator.validateCharacter(character);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'name' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should pass validation when id is present (derived from file path)', () => {
      const character = createValidCharacter();
      const result = CharacterValidator.validateCharacter(character);
      
      expect(result.isValid).toBe(true);
    });

    it('should fail validation when category is missing', () => {
      const character = createValidCharacter();
      character.category = '';
      const result = CharacterValidator.validateCharacter(character);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'category' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when filePath is missing', () => {
      const character = createValidCharacter();
      character.filePath = '';
      const result = CharacterValidator.validateCharacter(character);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'filePath' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when tags is not an array', () => {
      const character = createValidCharacter();
      (character as any).tags = 'not-an-array';
      const result = CharacterValidator.validateCharacter(character);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'tags' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('should fail validation when created date is invalid', () => {
      const character = createValidCharacter();
      character.created = new Date('invalid');
      const result = CharacterValidator.validateCharacter(character);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'created' && e.code === 'INVALID_DATE')).toBe(true);
    });

    it('should fail validation when modified date is invalid', () => {
      const character = createValidCharacter();
      character.modified = new Date('invalid');
      const result = CharacterValidator.validateCharacter(character);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'modified' && e.code === 'INVALID_DATE')).toBe(true);
    });

    it('should fail validation when name exceeds 255 characters', () => {
      const character = createValidCharacter();
      character.name = 'a'.repeat(256);
      const result = CharacterValidator.validateCharacter(character);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'name' && e.code === 'MAX_LENGTH_EXCEEDED')).toBe(true);
    });

    it('should pass validation when name is exactly 255 characters', () => {
      const character = createValidCharacter();
      character.name = 'a'.repeat(255);
      const result = CharacterValidator.validateCharacter(character);
      
      expect(result.isValid).toBe(true);
    });
  });

  describe('validateCharacterFormData', () => {
    const createValidFormData = (): CharacterFormData => ({
      name: 'Test Character',
      category: 'main-character',
      tags: ['magic-user'],
      books: [],
      content: 'Test content'
    });

    it('should validate valid form data', () => {
      const formData = createValidFormData();
      const result = CharacterValidator.validateCharacterFormData(formData);
      
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should fail validation when name is missing', () => {
      const formData = createValidFormData();
      formData.name = '';
      const result = CharacterValidator.validateCharacterFormData(formData);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'name' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when category is missing', () => {
      const formData = createValidFormData();
      formData.category = '';
      const result = CharacterValidator.validateCharacterFormData(formData);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'category' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when tags is not an array', () => {
      const formData = createValidFormData();
      (formData as any).tags = 'not-an-array';
      const result = CharacterValidator.validateCharacterFormData(formData);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'tags' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('should fail validation when name exceeds 255 characters', () => {
      const formData = createValidFormData();
      formData.name = 'a'.repeat(256);
      const result = CharacterValidator.validateCharacterFormData(formData);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'name' && e.code === 'MAX_LENGTH_EXCEEDED')).toBe(true);
    });

    it('should fail validation when content exceeds 100000 characters', () => {
      const formData = createValidFormData();
      formData.content = 'a'.repeat(100001);
      const result = CharacterValidator.validateCharacterFormData(formData);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'content' && e.code === 'MAX_LENGTH_EXCEEDED')).toBe(true);
    });

    it('should pass validation when content is exactly 100000 characters', () => {
      const formData = createValidFormData();
      formData.content = 'a'.repeat(100000);
      const result = CharacterValidator.validateCharacterFormData(formData);
      
      expect(result.isValid).toBe(true);
    });
  });

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
        defaultCategory: 'main-character',
        autoSave: true,
        fileWatchEnabled: true
      }
    });

    const createValidCharacter = (): Character => ({
      id: '_test-character.md',
      name: 'Test Character',
      category: 'main-character',
      tags: ['magic-user'],
      books: [],
      content: '',
      created: new Date(),
      modified: new Date(),
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
  });
});

