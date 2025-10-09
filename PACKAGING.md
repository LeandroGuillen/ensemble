# Packaging Guide for Ensemble

This guide explains how to package Ensemble for distribution across different platforms.

## Prerequisites

### All Platforms
- Node.js 18+ and npm
- All dependencies installed: `npm install`

### Platform-Specific Requirements

#### macOS
- macOS system (required for .dmg and .app builds)
- Xcode Command Line Tools: `xcode-select --install`
- Optional: Apple Developer account for code signing and notarization

#### Windows
- Can be built on any platform
- Optional: Code signing certificate for trusted installation

#### Linux
- For AppImage and .deb: No additional requirements
- For RPM: Install `rpmbuild` tool
  - Fedora/RHEL: `sudo dnf install rpm-build`
  - Debian/Ubuntu: `sudo apt install rpm`

## Platform Build Compatibility

| Build Platform | Can Build For                           |
|----------------|----------------------------------------|
| **Linux**      | Linux (native), Windows (with wine)    |
| **macOS**      | macOS (native), Linux, Windows         |
| **Windows**    | Windows (native), Linux                |

**Important**: macOS builds (.dmg, .app) **require macOS** - cannot be built on Linux/Windows.

## Quick Start

### Build for Current Platform
```bash
npm run build-electron
```

### Build for Specific Platforms
```bash
# macOS - REQUIRES macOS system
npm run build-electron-mac

# Windows - Works from any platform (requires proper icons)
npm run build-electron-win

# Linux (AppImage + deb) - Works from any platform
npm run build-electron-linux

# Linux AppImage only
npm run build-electron-linux-appimage

# Linux deb only
npm run build-electron-linux-deb
```

### Build for All Platforms
```bash
# Only use on macOS, or it will fail trying to build .dmg
npm run dist
npm run build-electron-all
```

## Build Output

All built packages are placed in the `release/` directory:

### macOS
- `Ensemble-1.0.0.dmg` - Drag-and-drop installer (Universal: x64 + arm64)
- `Ensemble-1.0.0-mac.zip` - Compressed app bundle

### Windows
- `Ensemble Setup 1.0.0.exe` - NSIS installer (x64 + ia32)
- `Ensemble 1.0.0.exe` - Portable executable (no installation required)

### Linux
- `Ensemble-1.0.0.AppImage` - Universal Linux package (x64)
- `ensemble_1.0.0_amd64.deb` - Debian/Ubuntu package

## Package Metadata

The following metadata is configured in `package.json`:

```json
{
  "name": "ensemble",
  "version": "1.0.0",
  "description": "Character management application for writers and worldbuilders",
  "author": {
    "name": "Ensemble Team",
    "email": "contact@ensemble.app"
  },
  "homepage": "https://github.com/ensemble/ensemble",
  "repository": {
    "type": "git",
    "url": "https://github.com/ensemble/ensemble.git"
  }
}
```

Update these fields before building for distribution.

## Application Icons

Icons are located in `build/icons/`:

- **Windows**: `icon.ico` (multi-size: 16x16, 32x32, 48x48, 256x256)
- **macOS**: `icon.icns` (multi-size: 16x16 to 1024x1024)
- **Linux**: Individual PNG files (16x16, 32x32, 48x48, 64x64, 128x128, 256x256, 512x512)

### Generating Icons

The project includes placeholder icons. To generate proper icons:

1. **From SVG** (recommended):
   ```bash
   npm install -g electron-icon-builder
   electron-icon-builder --input=build/icons/icon.svg --output=build/icons --flatten
   ```

2. **Online tools**:
   - [Icon Kitchen](https://icon.kitchen/)
   - [Electron Icon Builder](https://www.electron.build/icons)

3. **Manual creation**:
   - Use design tools (GIMP, Inkscape, Photoshop, Figma)
   - Export to required sizes and formats
   - Replace files in `build/icons/`

## Build Process Details

### Step 1: Angular Build
The Angular application is built for production:
```bash
ng build --configuration production
```

Output goes to `dist/` directory.

### Step 2: Electron Packaging
electron-builder packages the app with Electron:
- Copies `dist/`, `main.js`, and dependencies
- Embeds Electron runtime
- Creates platform-specific installers
- Adds icons and metadata

### Step 3: Code Signing (Optional)

#### macOS
```bash
export CSC_LINK=/path/to/certificate.p12
export CSC_KEY_PASSWORD=your-password
npm run build-electron-mac
```

For notarization (required for Gatekeeper):
```bash
export APPLE_ID=your-apple-id@email.com
export APPLE_ID_PASSWORD=app-specific-password
npm run build-electron-mac
```

#### Windows
```bash
export CSC_LINK=/path/to/certificate.pfx
export CSC_KEY_PASSWORD=your-password
npm run build-electron-win
```

## Troubleshooting

### "Please specify author email" error
Add author information to `package.json`:
```json
"author": {
  "name": "Your Name",
  "email": "your.email@example.com"
}
```

### "Please specify homepage" error
Add homepage to `package.json`:
```json
"homepage": "https://your-project-url.com"
```

### Angular build warnings about bundle size
These are warnings, not errors. To fix:
- Optimize component styles
- Adjust budgets in `angular.json`

### RPM build fails on Linux
Install rpmbuild:
```bash
# Fedora/RHEL
sudo dnf install rpm-build

# Debian/Ubuntu
sudo apt install rpm
```

Or skip RPM and build AppImage/deb only:
```bash
npm run build-electron-linux-appimage
npm run build-electron-linux-deb
```

### macOS build fails on non-macOS system
**macOS builds absolutely require a macOS system.** electron-builder cannot create .dmg or .app files on Linux/Windows.

Solutions:
- Use a Mac for building
- Use CI/CD with macOS runners (GitHub Actions, CircleCI)
- Use a cloud Mac service (MacStadium, MacinCloud)
- Skip macOS builds and let users build from source on Mac

### Windows build fails with "icon has unknown format"
The placeholder icons aren't valid. Either:
- Generate proper icons (see "Generating Icons" section above)
- Remove `icon.ico` and electron-builder will generate one from PNGs
- Build on actual Windows system

### Windows build from Linux requires wine
To build Windows packages on Linux, you need wine:
```bash
# Debian/Ubuntu
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install wine wine32

# Fedora
sudo dnf install wine
```

Or build on actual Windows system.

## Distribution Checklist

Before distributing your build:

- [ ] Update version in `package.json`
- [ ] Update author, homepage, and repository fields
- [ ] Replace placeholder icons with real application icons
- [ ] Test the application on target platforms
- [ ] Review and update LICENSE file
- [ ] Create release notes/changelog
- [ ] Consider code signing (especially for macOS and Windows)
- [ ] Test installation on clean systems
- [ ] Verify file associations and desktop integration

## Continuous Integration (Recommended)

**For all platforms**, use CI/CD with platform-specific runners. This is the best way to build for macOS, Windows, and Linux.

### GitHub Actions Workflow

Create `.github/workflows/build.yml`:

```yaml
name: Build Ensemble
on:
  push:
    branches: [main, master]
  pull_request:
  release:
    types: [created]

jobs:
  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      - run: npm ci
      - run: npm run build-electron-linux
      - uses: actions/upload-artifact@v4
        with:
          name: linux-packages
          path: |
            release/*.AppImage
            release/*.deb

  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      - run: npm ci
      - run: npm run build-electron-mac
      - uses: actions/upload-artifact@v4
        with:
          name: mac-packages
          path: |
            release/*.dmg
            release/*.zip

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      - run: npm ci
      - run: npm run build-electron-win
      - uses: actions/upload-artifact@v4
        with:
          name: windows-packages
          path: |
            release/*.exe

  # Optional: Create GitHub Release with all artifacts
  release:
    needs: [build-linux, build-mac, build-windows]
    runs-on: ubuntu-latest
    if: github.event_name == 'release'
    steps:
      - uses: actions/download-artifact@v4
      - name: Upload to Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            linux-packages/*
            mac-packages/*
            windows-packages/*
```

This workflow:
- Builds on each platform using native runners
- Creates artifacts you can download
- Optionally attaches to GitHub Releases

## Further Reading

- [electron-builder Documentation](https://www.electron.build/)
- [Code Signing Guide](https://www.electron.build/code-signing)
- [Publishing and Updating](https://www.electron.build/auto-update)
- [Configuration Options](https://www.electron.build/configuration/configuration)
