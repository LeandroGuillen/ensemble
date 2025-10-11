# AppImage Desktop Integration Guide

This guide explains how to properly integrate Ensemble AppImage with your Linux desktop environment so that icons and desktop entries work correctly.

## The Problem

AppImages are self-contained applications that don't automatically integrate with your desktop environment. When you run an AppImage by double-clicking it, you may notice:

- No icon shows in the taskbar/window
- App doesn't appear in application menu
- No desktop shortcut created
- Window shows generic icon instead of Ensemble emblem

**Why?** AppImages run from temporary mount points and don't install files to your system. Your desktop environment (KDE, GNOME, etc.) doesn't know about the app's icon or desktop entry that's embedded inside the AppImage.

## Solutions

### Solution 1: AppImageLauncher (Recommended for Regular Use)

**AppImageLauncher** is a helper application that automatically integrates AppImages when you run them.

#### Install on Fedora:
```bash
sudo dnf install appimagelauncher
```

#### Install on Ubuntu/Debian:
```bash
sudo add-apt-repository ppa:appimagelauncher-team/stable
sudo apt update
sudo apt install appimagelauncher
```

#### How it works:
1. Run the AppImage (double-click or `./Ensemble-0.1.0.AppImage`)
2. AppImageLauncher prompts: "Do you want to integrate this AppImage?"
3. Click "Yes" - it copies the AppImage to `~/Applications/` and installs desktop entry
4. Icon now shows correctly everywhere!

**Benefits:**
- ✅ Automatic integration
- ✅ Works for all AppImages
- ✅ Updates desktop database automatically
- ✅ Removes integration when AppImage is deleted

---

### Solution 2: Manual Integration Script (For Development)

If you don't want to install AppImageLauncher or need integration for development builds, use our script:

```bash
./scripts/integrate-appimage.sh
```

**What it does:**
1. Extracts icon from AppImage → `~/.local/share/icons/hicolor/1024x1024/apps/`
2. Creates desktop entry → `~/.local/share/applications/ensemble.desktop`
3. Updates desktop database
4. App appears in menu with correct icon

**When to use:**
- Testing development builds
- One-time integration
- Systems without AppImageLauncher

**Limitations:**
- Must re-run if you move the AppImage
- Must re-run after rebuilding AppImage
- Manual cleanup required when uninstalling

---

### Solution 3: Use RPM Package (Best for Fedora)

For Fedora/RHEL/CentOS users, RPM packages provide native integration:

#### Build RPM:
```bash
npm run build-electron-linux-rpm
```

#### Install:
```bash
sudo dnf install release/ensemble-0.1.0.x86_64.rpm
```

**Benefits:**
- ✅ Native package manager integration
- ✅ Icons work automatically
- ✅ Appears in application menu
- ✅ Easy updates: `sudo dnf upgrade ensemble`
- ✅ Clean uninstall: `sudo dnf remove ensemble`

**RPM vs AppImage:**
| Feature | RPM | AppImage |
|---------|-----|----------|
| Desktop integration | Automatic | Manual/AppImageLauncher |
| Updates | Package manager | Manual download |
| Permissions | Requires sudo | No sudo needed |
| Portability | Distro-specific | Universal |
| Distribution | Best for Fedora | Best for cross-distro |

---

### Solution 4: Use .deb Package (For Debian/Ubuntu)

For Debian/Ubuntu users:

```bash
npm run build-electron-linux-deb
sudo apt install ./release/ensemble_0.1.0_amd64.deb
```

---

## Verifying Integration

After integration, verify with:

```bash
# Check desktop file
ls ~/.local/share/applications/ensemble.desktop

# Check icon
ls ~/.local/share/icons/hicolor/1024x1024/apps/ensemble.png

# Test launch from menu
# Look for "Ensemble" in your application menu
```

## Removing Integration

### If using AppImageLauncher:
Simply delete the AppImage - AppImageLauncher removes integration automatically.

### If using manual script:
```bash
rm ~/.local/share/applications/ensemble.desktop
rm ~/.local/share/icons/hicolor/1024x1024/apps/ensemble.png
update-desktop-database ~/.local/share/applications
```

### If using RPM:
```bash
sudo dnf remove ensemble
```

### If using .deb:
```bash
sudo apt remove ensemble
```

## Recommendations by Use Case

| Use Case | Recommended Solution |
|----------|---------------------|
| **Daily use on Fedora** | Build and install RPM package |
| **Daily use on Ubuntu** | Build and install .deb package |
| **Testing/Development** | Manual integration script |
| **Cross-distribution** | AppImageLauncher + AppImage |
| **Portable/USB stick** | Just run AppImage directly (no integration) |

## Building Packages

```bash
# AppImage (universal, but needs integration)
npm run build-electron-linux-appimage

# RPM (Fedora, RHEL, CentOS, openSUSE)
npm run build-electron-linux-rpm

# deb (Debian, Ubuntu, Linux Mint)
npm run build-electron-linux-deb

# All Linux targets
npm run build-electron-linux
```

## Troubleshooting

### Icon still doesn't show after integration
```bash
# Refresh icon cache
gtk-update-icon-cache ~/.local/share/icons/hicolor -f

# Refresh desktop database
update-desktop-database ~/.local/share/applications

# Restart desktop environment (or logout/login)
```

### "Icon not found" errors
Check icon exists:
```bash
ls -la ~/.local/share/icons/hicolor/1024x1024/apps/ensemble.png
```

If missing, re-run integration script or reinstall package.

### AppImage won't run
```bash
# Make executable
chmod +x Ensemble-0.1.0.AppImage

# Run with --appimage-extract-and-run (bypasses FUSE)
./Ensemble-0.1.0.AppImage --appimage-extract-and-run
```

### RPM build fails
Install rpm-build tools:
```bash
sudo dnf install rpm-build
```

## Further Reading

- [AppImage Documentation](https://docs.appimage.org/)
- [AppImageLauncher GitHub](https://github.com/TheAssassin/AppImageLauncher)
- [electron-builder Linux Configuration](https://www.electron.build/configuration/linux)
- [FreeDesktop.org Desktop Entry Specification](https://specifications.freedesktop.org/desktop-entry-spec/latest/)
