# Releasing

How Ensemble releases are cut, and how the Linux packages are tested. See the [README](../README.md) for the project overview.

## Releases and updates

Push a tag matching `package.json` (for example, `v1.14.5`) to run the release
workflow. It builds AppImage, DEB, and RPM packages on Linux, and one publish
job uploads the packages and their update metadata to the same GitHub release.
The update feed needs both the package and its metadata; uploading an installer
alone is insufficient. There is no macOS build.

Installed builds check GitHub Releases at startup and every four hours. Users
can also check in Settings. When an update is ready, **Quit and Install** asks
`electron-updater` to install the package matching the current platform.
Linux AppImage users should keep the AppImage in a directory they can write to,
so the updater can replace it. DEB and RPM installs use their respective package
managers and may request administrator authentication. Builds run from source do
not update themselves.

## Testing Linux packages

Run the **Build and Release** workflow manually from GitHub Actions to build Linux
artifacts and smoke test them without publishing a release. Every tagged release
runs the same checks before publishing:

- A clean Debian container installs the DEB and opens an Ensemble window under Xvfb.
- A separate Debian container runs the AppImage with its extract-and-run fallback.
- A clean Fedora container installs the RPM and opens an Ensemble window under Xvfb.

These jobs test the generated artifacts and package dependencies on other Linux
userlands. They do not exercise FUSE mounting, desktop integration, a real user
session, package manager authentication, or installation of an update over an
older version. Use full Debian and Fedora VMs for those final release checks.
