// Verification script to check if all files are in place
const fs = require('fs');
const path = require('path');

console.log('🔍 Verifying Ensemble setup...\n');

const requiredFiles = [
  'package.json',
  'main.js',
  'angular.json',
  'tsconfig.json',
  'src/main.ts',
  'src/index.html',
  'src/app/app.component.ts',
  'src/app/app.config.ts',
  'src/app/app.routes.ts'
];

let allFilesExist = true;

requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - MISSING`);
    allFilesExist = false;
  }
});

console.log('\n📦 Package.json configuration:');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
console.log(`   Main entry: ${pkg.main}`);
console.log(`   Electron script: ${pkg.scripts.electron}`);
console.log(`   Electron-dev script: ${pkg.scripts['electron-dev']}`);

console.log('\n🏗️  Angular configuration:');
const angular = JSON.parse(fs.readFileSync('angular.json', 'utf8'));
console.log(`   Output path: ${angular.projects.ensemble.architect.build.options.outputPath}`);

if (allFilesExist) {
  console.log('\n🎉 Setup verification complete! All required files are present.');
  console.log('\n📋 Next steps:');
  console.log('   1. Run "npm install" to install dependencies');
  console.log('   2. Run "npm run electron-dev" to start the application');
} else {
  console.log('\n❌ Setup verification failed! Some required files are missing.');
}