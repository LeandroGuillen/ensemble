# Build Configuration

This directory contains the build configuration and assets for packaging the Ensemble application with electron-builder.

## Directory Structure

```
build/
├── icons/                  # Application icons for all platforms
│   ├── icon.svg           # Source SVG icon (512x512)
│   ├── icon.ico           # Windows icon (multiple sizes)
│   ├── icon.icns          # macOS icon (multiple sizes)
│   ├── 16x16.png          # Linux icon
│   ├── 32x32.png          # Linux icon
│   ├── 48x48.png          # Linux icon
│   ├── 64x64.png          # Linux icon
│   ├── 128x128.png        # Linux icon
│   ├── 256x256.png        # Linux icon
│   └── 512x512.png        # Linux icon
├── entitlements.mac.plist # macOS entitlements for code signing
└── README.md              # This file
```

## Icon Requirements

### Windows (.ico)
- Must contain multiple sizes: 16x16, 32x32, 48x48, 256x256
- Use tools like GIMP, Photoshop, or online converters

### macOS (.icns)
- Must contain multiple sizes: 16x16, 32x32, 128x128, 256x256, 512x512, 1024x1024
- Use `iconutil` on macOS or online converters
- Example: `iconutil -c icns icon.iconset`

### Linux (.png)
- Individual PNG files for each size
- Sizes: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256, 512x512

## Creating Icons from SVG

You can use the provided `icon.svg` as a source to generate all required formats:

### Online Tools
- [Icon Kitchen](https://icon.kitchen/) - Generate all formats from SVG
- [Electron Icon Builder](https://www.electron.build/icons) - Official tool

### Command Line Tools
```bash
# Install electron-icon-builder globally
npm install -g electron-icon-builder

# Generate all icons from SVG
electron-icon-builder --input=build/icons/icon.svg --output=build/icons --flatten
```

### Manual Creation
1. Open `icon.svg` in a graphics editor (GIMP, Inkscape, etc.)
2. Export to required sizes and formats
3. Replace the placeholder files in this directory

## Build Scripts

The following npm scripts are available for building:

```bash
# Build for all platforms
npm run build-electron-all

# Build for specific platforms
npm run build-electron-mac
npm run build-electron-win
npm run build-electron-linux

# Build for current platform only
npm run build-electron

# Generate distribution packages
npm run dist
```

## Platform-Specific Notes

### macOS
- Requires macOS to build .dmg and .app files
- Code signing requires Apple Developer account
- Notarization required for distribution outside App Store

### Windows
- Can be built on any platform
- NSIS installer and portable executable generated
- Code signing requires certificate for distribution

### Linux
- AppImage works on most distributions
- .deb for Debian/Ubuntu
- .rpm for Red Hat/Fedora/SUSE

## Output

Built applications will be placed in the `release/` directory with the following structure:

```
release/
├── Ensemble-1.0.0.dmg              # macOS installer
├── Ensemble-1.0.0-mac.zip          # macOS app bundle
├── Ensemble Setup 1.0.0.exe        # Windows installer
├── Ensemble 1.0.0.exe               # Windows portable
├── Ensemble-1.0.0.AppImage          # Linux AppImage
├── ensemble_1.0.0_amd64.deb         # Linux Debian package
└── ensemble-1.0.0.x86_64.rpm        # Linux RPM package
```