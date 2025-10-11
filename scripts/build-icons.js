#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Ensemble Icon Generator');
console.log('======================\n');

// Paths
const iconsDir = path.join(__dirname, '..', 'build', 'icons');
const svgPath = path.join(iconsDir, 'icon.svg');
const pngPath = path.join(iconsDir, 'icon-1024.png');

// Ensure icons directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
  console.log('✓ Created build/icons directory\n');
}

// Check if source SVG exists
if (!fs.existsSync(svgPath)) {
  console.error('❌ Error: icon.svg not found in build/icons/');
  console.log('\nPlease add a source SVG icon at build/icons/icon.svg');
  console.log('The SVG should be at least 512x512 for best quality.\n');
  process.exit(1);
}

console.log('Found source icon: icon.svg');

try {
  // Step 1: Convert SVG to high-res PNG using ImageMagick
  console.log('\n1. Converting SVG to 1024x1024 PNG...');

  try {
    execSync(`magick convert -background none -resize 1024x1024 "${svgPath}" "${pngPath}"`, {
      stdio: 'inherit'
    });
  } catch (e) {
    // Try with older ImageMagick command
    execSync(`convert -background none -resize 1024x1024 "${svgPath}" "${pngPath}"`, {
      stdio: 'inherit'
    });
  }

  console.log('   ✓ Created icon-1024.png');

  // Step 2: Generate all icon formats using electron-icon-builder
  console.log('\n2. Generating icon files for all platforms...');
  execSync(`npx electron-icon-builder --input="${pngPath}" --output="${iconsDir}" --flatten`, {
    stdio: 'inherit'
  });

  // Step 3: Move icons from subdirectory if needed
  const iconsSubdir = path.join(iconsDir, 'icons');
  if (fs.existsSync(iconsSubdir)) {
    console.log('\n3. Moving icons to correct location...');
    const files = fs.readdirSync(iconsSubdir);
    files.forEach(file => {
      const src = path.join(iconsSubdir, file);
      const dest = path.join(iconsDir, file);
      fs.renameSync(src, dest);
    });
    fs.rmdirSync(iconsSubdir);
    console.log('   ✓ Icons moved to build/icons/');
  }

  console.log('\n✓ Icon generation complete!');
  console.log('\nGenerated files:');
  console.log('  - icon.ico (Windows)');
  console.log('  - icon.icns (macOS)');
  console.log('  - Multiple PNG files (Linux)');
  console.log('\nYou can now build the application with proper icons.\n');

} catch (error) {
  console.error('\n❌ Error generating icons:', error.message);
  console.log('\nTroubleshooting:');
  console.log('1. Ensure ImageMagick is installed: sudo dnf install ImageMagick');
  console.log('2. Or use online tools like https://icon.kitchen/');
  console.log('3. Manually place icon files in build/icons/\n');
  process.exit(1);
}