#!/usr/bin/env node

/**
 * Migration script to convert flat character structure to folder-based structure
 *
 * Old structure:
 *   characters/
 *     ├── character-name.md
 *     └── another-character.md
 *   thumbnails/
 *     ├── character-id.jpg
 *     └── another-id.png
 *
 * New structure:
 *   characters/
 *     └── <category-slug>/
 *         └── <character-slug>/
 *             ├── <character-slug>.md
 *             └── thumbnail.png
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

/**
 * Converts a string to a URL-safe slug
 */
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[<>:"|?*\/\\]/g, '')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .substring(0, 100);
}

/**
 * Extracts frontmatter and content from a markdown file
 */
function parseMarkdown(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, content: content.trim() };
  }

  try {
    const frontmatter = yaml.load(match[1]);
    const markdownContent = match[2].trim();
    return { frontmatter, content: markdownContent };
  } catch (error) {
    console.error('Failed to parse YAML frontmatter:', error);
    return { frontmatter: {}, content: content.trim() };
  }
}

/**
 * Main migration function
 */
async function migrateCharacters(projectPath) {
  console.log(`\n🔄 Starting migration for project: ${projectPath}\n`);

  const charactersPath = path.join(projectPath, 'characters');
  const thumbnailsPath = path.join(projectPath, 'thumbnails');
  const backupPath = path.join(projectPath, 'characters_backup_' + Date.now());

  // Check if characters directory exists
  try {
    await fs.access(charactersPath);
  } catch (error) {
    console.error('❌ Characters directory not found:', charactersPath);
    process.exit(1);
  }

  // Create backup
  console.log('📦 Creating backup...');
  try {
    await fs.cp(charactersPath, backupPath, { recursive: true });
    console.log(`✅ Backup created at: ${backupPath}\n`);
  } catch (error) {
    console.error('❌ Failed to create backup:', error.message);
    process.exit(1);
  }

  // Read all markdown files
  const files = await fs.readdir(charactersPath);
  const mdFiles = files.filter(f => f.endsWith('.md'));

  if (mdFiles.length === 0) {
    console.log('ℹ️  No markdown files found to migrate');
    return;
  }

  console.log(`📚 Found ${mdFiles.length} character files to migrate\n`);

  let migratedCount = 0;
  let errorCount = 0;

  for (const filename of mdFiles) {
    try {
      const filePath = path.join(charactersPath, filename);
      const content = await fs.readFile(filePath, 'utf8');
      const { frontmatter } = parseMarkdown(content);

      if (!frontmatter.name) {
        console.warn(`⚠️  Skipping ${filename}: No name in frontmatter`);
        errorCount++;
        continue;
      }

      // Generate slugs
      const characterSlug = slugify(frontmatter.name);
      const categorySlug = frontmatter.category ? slugify(frontmatter.category) : 'uncategorized';

      // Create folder structure
      const categoryPath = path.join(charactersPath, categorySlug);
      const characterFolderPath = path.join(categoryPath, characterSlug);

      await fs.mkdir(categoryPath, { recursive: true });
      await fs.mkdir(characterFolderPath, { recursive: true });

      // Move character file
      const newFilePath = path.join(characterFolderPath, `${characterSlug}.md`);
      await fs.copyFile(filePath, newFilePath);

      // Handle thumbnail if it exists
      if (frontmatter.thumbnail) {
        const oldThumbnailPath = path.join(thumbnailsPath, frontmatter.thumbnail);

        try {
          await fs.access(oldThumbnailPath);

          // Get file extension
          const ext = path.extname(frontmatter.thumbnail);
          const newThumbnailName = `thumbnail${ext}`;
          const newThumbnailPath = path.join(characterFolderPath, newThumbnailName);

          // Copy thumbnail
          await fs.copyFile(oldThumbnailPath, newThumbnailPath);

          // Update frontmatter reference
          const updatedContent = content.replace(
            `thumbnail: ${frontmatter.thumbnail}`,
            `thumbnail: ${newThumbnailName}`
          );
          await fs.writeFile(newFilePath, updatedContent, 'utf8');

          console.log(`✅ ${frontmatter.name} (with thumbnail)`);
        } catch (error) {
          // Thumbnail doesn't exist, just migrate without it
          console.log(`✅ ${frontmatter.name} (no thumbnail found)`);
        }
      } else {
        console.log(`✅ ${frontmatter.name}`);
      }

      // Delete old file
      await fs.unlink(filePath);
      migratedCount++;

    } catch (error) {
      console.error(`❌ Failed to migrate ${filename}:`, error.message);
      errorCount++;
    }
  }

  // Clean up empty thumbnails directory (optional)
  try {
    const thumbnailFiles = await fs.readdir(thumbnailsPath);
    if (thumbnailFiles.length === 0) {
      await fs.rmdir(thumbnailsPath);
      console.log('\n🗑️  Removed empty thumbnails directory');
    }
  } catch (error) {
    // Directory doesn't exist or not empty, that's fine
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✨ Migration complete!`);
  console.log(`   Migrated: ${migratedCount}`);
  console.log(`   Errors: ${errorCount}`);
  console.log(`   Backup: ${backupPath}`);
  console.log('='.repeat(50) + '\n');
}

// CLI interface
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
📂 Character Folder Migration Script

Usage:
  node scripts/migrate-to-folder-structure.js <project-path>

Example:
  node scripts/migrate-to-folder-structure.js /path/to/my-project

This script will:
  1. Create a backup of your characters directory
  2. Convert flat character files to folder structure
  3. Move thumbnails into character folders
  4. Update thumbnail references in frontmatter

The old structure will be backed up before migration.
  `);
  process.exit(0);
}

const projectPath = path.resolve(args[0]);

migrateCharacters(projectPath).catch(error => {
  console.error('\n❌ Migration failed:', error);
  process.exit(1);
});
