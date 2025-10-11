#!/bin/bash
# AppImage Desktop Integration Script for Ensemble
# This script manually integrates the AppImage with your desktop environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APPIMAGE_PATH="$PROJECT_DIR/release/Ensemble-0.1.0.AppImage"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Ensemble AppImage Desktop Integration"
echo "======================================"
echo ""

# Check if AppImage exists
if [ ! -f "$APPIMAGE_PATH" ]; then
    echo -e "${RED}Error: AppImage not found at $APPIMAGE_PATH${NC}"
    echo "Please build the AppImage first: npm run build-electron-linux-appimage"
    exit 1
fi

echo -e "${GREEN}Found AppImage:${NC} $APPIMAGE_PATH"

# Create directories
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/1024x1024/apps"

mkdir -p "$DESKTOP_DIR"
mkdir -p "$ICON_DIR"

echo ""
echo "Extracting AppImage contents..."

# Extract AppImage to temp directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"
"$APPIMAGE_PATH" --appimage-extract > /dev/null 2>&1

# Copy icon
echo -e "${GREEN}Installing icon...${NC}"
cp squashfs-root/ensemble.png "$ICON_DIR/"
chmod 644 "$ICON_DIR/ensemble.png"

# Create desktop file with absolute path to AppImage
echo -e "${GREEN}Creating desktop entry...${NC}"
cat > "$DESKTOP_DIR/ensemble.desktop" << EOF
[Desktop Entry]
Name=Ensemble
Exec="$APPIMAGE_PATH" --no-sandbox %U
Terminal=false
Type=Application
Icon=ensemble
StartupWMClass=Ensemble
Categories=Office;
Comment=Character management application for writers and worldbuilders
Keywords=writing;characters;worldbuilding;story;
EOF

chmod 644 "$DESKTOP_DIR/ensemble.desktop"

# Clean up
cd - > /dev/null
rm -rf "$TEMP_DIR"

# Update desktop database
echo -e "${GREEN}Updating desktop database...${NC}"
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo ""
echo -e "${GREEN}✓ Integration complete!${NC}"
echo ""
echo "Ensemble should now appear in your application menu with the correct icon."
echo "You can also run it from the command line: $APPIMAGE_PATH"
echo ""
echo -e "${YELLOW}Note:${NC} If you move the AppImage, run this script again."
echo ""

# Offer to install AppImageLauncher
echo -e "${YELLOW}Tip:${NC} For automatic AppImage integration, install AppImageLauncher:"
echo "  sudo dnf install appimagelauncher"
echo ""
