import { ProjectValidator } from './project.validator';
import { ProjectMetadata, Category, Tag, Book, ProjectSettings } from '../interfaces/project.interface';

describe('ProjectValidator', () => {
  const createValidMetadata = (): ProjectMetadata => ({
    projectName: 'Test Project',
    version: '1.0.0',
    categories: [
      { id: 'main-character', name: 'Main Character', color: '#FF0000' }
    ],
    tags: [
      { id: 'magic-user', name: 'Magic User', color: '#0000FF' }
    ],
    casts: [],
    books: [],
    settings: {
      defaultCategory: 'main-character',
      autoSave: true,
      fileWatchEnabled: true
    }
  });

  describe('validateProjectMetadata', () => {
    it('should validate valid metadata', () => {
      const metadata = createValidMetadata();
      const result = ProjectValidator.validateProjectMetadata(metadata);
      
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should fail validation when projectName is missing', () => {
      const metadata = createValidMetadata();
      metadata.projectName = '';
      const result = ProjectValidator.validateProjectMetadata(metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'projectName' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when version is missing', () => {
      const metadata = createValidMetadata();
      metadata.version = '';
      const result = ProjectValidator.validateProjectMetadata(metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'version' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when version is not semantic', () => {
      const metadata = createValidMetadata();
      metadata.version = 'invalid-version';
      const result = ProjectValidator.validateProjectMetadata(metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'version' && e.code === 'INVALID_FORMAT')).toBe(true);
    });

    it('should pass validation with valid semantic version', () => {
      const metadata = createValidMetadata();
      metadata.version = '2.5.10';
      const result = ProjectValidator.validateProjectMetadata(metadata);
      
      expect(result.isValid).toBe(true);
    });

    it('should fail validation when categories is not an array', () => {
      const metadata = createValidMetadata();
      (metadata as any).categories = 'not-an-array';
      const result = ProjectValidator.validateProjectMetadata(metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'categories' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('should fail validation when tags is not an array', () => {
      const metadata = createValidMetadata();
      (metadata as any).tags = 'not-an-array';
      const result = ProjectValidator.validateProjectMetadata(metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'tags' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('should fail validation when duplicate category IDs exist', () => {
      const metadata = createValidMetadata();
      metadata.categories.push({ id: 'main-character', name: 'Duplicate', color: '#FF0000' });
      const result = ProjectValidator.validateProjectMetadata(metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'categories' && e.code === 'DUPLICATE_ID')).toBe(true);
    });

    it('should fail validation when duplicate tag IDs exist', () => {
      const metadata = createValidMetadata();
      metadata.tags.push({ id: 'magic-user', name: 'Duplicate', color: '#0000FF' });
      const result = ProjectValidator.validateProjectMetadata(metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'tags' && e.code === 'DUPLICATE_ID')).toBe(true);
    });

    it('should fail validation when settings is missing', () => {
      const metadata = createValidMetadata();
      (metadata as any).settings = null;
      const result = ProjectValidator.validateProjectMetadata(metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'settings' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when defaultCategory does not exist in categories', () => {
      const metadata = createValidMetadata();
      metadata.settings.defaultCategory = 'non-existent-category';
      const result = ProjectValidator.validateProjectMetadata(metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'settings.defaultCategory' && e.code === 'INVALID_REFERENCE')).toBe(true);
    });

    it('should validate invalid categories within metadata', () => {
      const metadata = createValidMetadata();
      metadata.categories.push({ id: '', name: 'Invalid', color: '#FF0000' });
      const result = ProjectValidator.validateProjectMetadata(metadata);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field.startsWith('categories[') && e.field.includes('id'))).toBe(true);
    });
  });

  describe('validateCategory', () => {
    it('should validate valid category', () => {
      const category: Category = { id: 'test-category', name: 'Test Category', color: '#FF0000' };
      const result = ProjectValidator.validateCategory(category);
      
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should fail validation when id is missing', () => {
      const category: Category = { id: '', name: 'Test Category', color: '#FF0000' };
      const result = ProjectValidator.validateCategory(category);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'id' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when name is missing', () => {
      const category: Category = { id: 'test-category', name: '', color: '#FF0000' };
      const result = ProjectValidator.validateCategory(category);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'name' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when color is missing', () => {
      const category: Category = { id: 'test-category', name: 'Test Category', color: '' };
      const result = ProjectValidator.validateCategory(category);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'color' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when id is not kebab-case', () => {
      const category: Category = { id: 'Test Category', name: 'Test Category', color: '#FF0000' };
      const result = ProjectValidator.validateCategory(category);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'id' && e.code === 'INVALID_FORMAT')).toBe(true);
    });

    it('should pass validation with valid kebab-case id', () => {
      const category: Category = { id: 'main-character', name: 'Main Character', color: '#FF0000' };
      const result = ProjectValidator.validateCategory(category);
      
      expect(result.isValid).toBe(true);
    });

    it('should fail validation when color is not hex format', () => {
      const category: Category = { id: 'test-category', name: 'Test Category', color: 'red' };
      const result = ProjectValidator.validateCategory(category);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'color' && e.code === 'INVALID_FORMAT')).toBe(true);
    });

    it('should pass validation with valid hex color', () => {
      const category: Category = { id: 'test-category', name: 'Test Category', color: '#FF0000' };
      const result = ProjectValidator.validateCategory(category);
      
      expect(result.isValid).toBe(true);
    });

    it('should pass validation with 3-digit hex color', () => {
      const category: Category = { id: 'test-category', name: 'Test Category', color: '#F00' };
      const result = ProjectValidator.validateCategory(category);
      
      expect(result.isValid).toBe(true);
    });

    it('should fail validation when description exceeds 500 characters', () => {
      const category: Category = {
        id: 'test-category',
        name: 'Test Category',
        color: '#FF0000',
        description: 'a'.repeat(501)
      };
      const result = ProjectValidator.validateCategory(category);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'description' && e.code === 'INVALID_LENGTH')).toBe(true);
    });
  });

  describe('validateTag', () => {
    it('should validate valid tag', () => {
      const tag: Tag = { id: 'test-tag', name: 'Test Tag', color: '#FF0000' };
      const result = ProjectValidator.validateTag(tag);
      
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should fail validation when id is missing', () => {
      const tag: Tag = { id: '', name: 'Test Tag', color: '#FF0000' };
      const result = ProjectValidator.validateTag(tag);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'id' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when name is missing', () => {
      const tag: Tag = { id: 'test-tag', name: '', color: '#FF0000' };
      const result = ProjectValidator.validateTag(tag);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'name' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when color is missing', () => {
      const tag: Tag = { id: 'test-tag', name: 'Test Tag', color: '' };
      const result = ProjectValidator.validateTag(tag);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'color' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when id is not kebab-case', () => {
      const tag: Tag = { id: 'Test Tag', name: 'Test Tag', color: '#FF0000' };
      const result = ProjectValidator.validateTag(tag);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'id' && e.code === 'INVALID_FORMAT')).toBe(true);
    });

    it('should fail validation when color is not hex format', () => {
      const tag: Tag = { id: 'test-tag', name: 'Test Tag', color: 'blue' };
      const result = ProjectValidator.validateTag(tag);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'color' && e.code === 'INVALID_FORMAT')).toBe(true);
    });
  });

  describe('validateBook', () => {
    it('should validate valid book', () => {
      const book: Book = { id: 'test-book', name: 'Test Book', color: '#FF0000' };
      const result = ProjectValidator.validateBook(book);
      
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should fail validation when id is missing', () => {
      const book: Book = { id: '', name: 'Test Book', color: '#FF0000' };
      const result = ProjectValidator.validateBook(book);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'id' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when name is missing', () => {
      const book: Book = { id: 'test-book', name: '', color: '#FF0000' };
      const result = ProjectValidator.validateBook(book);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'name' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when color is missing', () => {
      const book: Book = { id: 'test-book', name: 'Test Book', color: '' };
      const result = ProjectValidator.validateBook(book);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'color' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when id is not kebab-case', () => {
      const book: Book = { id: 'Test Book', name: 'Test Book', color: '#FF0000' };
      const result = ProjectValidator.validateBook(book);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'id' && e.code === 'INVALID_FORMAT')).toBe(true);
    });

    it('should fail validation when status is invalid', () => {
      const book: Book = {
        id: 'test-book',
        name: 'Test Book',
        color: '#FF0000',
        status: 'invalid-status' as any
      };
      const result = ProjectValidator.validateBook(book);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'status' && e.code === 'INVALID_VALUE')).toBe(true);
    });

    it('should pass validation with valid status', () => {
      const book: Book = {
        id: 'test-book',
        name: 'Test Book',
        color: '#FF0000',
        status: 'published'
      };
      const result = ProjectValidator.validateBook(book);
      
      expect(result.isValid).toBe(true);
    });

    it('should fail validation when publicationDate format is invalid', () => {
      const book: Book = {
        id: 'test-book',
        name: 'Test Book',
        color: '#FF0000',
        publicationDate: 'invalid-date'
      };
      const result = ProjectValidator.validateBook(book);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'publicationDate' && e.code === 'INVALID_FORMAT')).toBe(true);
    });

    it('should pass validation with valid publicationDate', () => {
      const book: Book = {
        id: 'test-book',
        name: 'Test Book',
        color: '#FF0000',
        publicationDate: '2024-01-15'
      };
      const result = ProjectValidator.validateBook(book);
      
      expect(result.isValid).toBe(true);
    });

    it('should fail validation when description exceeds 1000 characters', () => {
      const book: Book = {
        id: 'test-book',
        name: 'Test Book',
        color: '#FF0000',
        description: 'a'.repeat(1001)
      };
      const result = ProjectValidator.validateBook(book);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'description' && e.code === 'INVALID_LENGTH')).toBe(true);
    });
  });

  describe('validateProjectSettings', () => {
    it('should validate valid settings', () => {
      const settings: ProjectSettings = {
        defaultCategory: 'main-character',
        autoSave: true,
        fileWatchEnabled: true,
        charactersFolder: 'personas'
      };
      const result = ProjectValidator.validateProjectSettings(settings);

      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should fail validation when defaultCategory is missing', () => {
      const settings: ProjectSettings = {
        defaultCategory: '',
        autoSave: true,
        fileWatchEnabled: true
      };
      const result = ProjectValidator.validateProjectSettings(settings);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'defaultCategory' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when autoSave is not boolean', () => {
      const settings: any = {
        defaultCategory: 'main-character',
        autoSave: 'true',
        fileWatchEnabled: true
      };
      const result = ProjectValidator.validateProjectSettings(settings);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'autoSave' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('should fail validation when fileWatchEnabled is not boolean', () => {
      const settings: any = {
        defaultCategory: 'main-character',
        autoSave: true,
        fileWatchEnabled: 'true'
      };
      const result = ProjectValidator.validateProjectSettings(settings);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'fileWatchEnabled' && e.code === 'INVALID_TYPE')).toBe(true);
    });
  });
});

