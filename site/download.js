/*
 * Fills the Download section from the latest GitHub release.
 * Without JS, or if the API fails, the HTML keeps a plain link to
 * https://github.com/LeandroGuillen/ensemble/releases/latest.
 * No version is hardcoded: everything comes from the API response.
 * API data is only ever written with textContent / attributes.
 */
(function () {
  'use strict';

  var API_URL = 'https://api.github.com/repos/LeandroGuillen/ensemble/releases/latest';
  var RELEASES_URL = 'https://github.com/LeandroGuillen/ensemble/releases/latest';
  var TIMEOUT_MS = 8000;

  // Ordered: first match wins. `primary` assets are installable packages;
  // the rest (updater metadata, checksums...) go under "Other files".
  var KINDS = [
    { test: /\.AppImage$/i, key: 'appimage', label: 'AppImage (any Linux distribution)', platform: 'Linux', primary: true },
    { test: /\.deb$/i, key: 'deb', label: 'Debian package (Debian, Ubuntu and derivatives)', platform: 'Linux', primary: true },
    { test: /\.rpm$/i, key: 'rpm', label: 'RPM package (Fedora, RHEL and derivatives)', platform: 'Linux', primary: true },
    { test: /\.pacman$/i, key: 'pacman', label: 'Pacman package (Arch Linux and derivatives)', platform: 'Linux', primary: true },
    { test: /\.snap$/i, key: 'snap', label: 'Snap package', platform: 'Linux', primary: true },
    { test: /\.flatpak$/i, key: 'flatpak', label: 'Flatpak bundle', platform: 'Linux', primary: true },
    { test: /\.tar\.(gz|xz|bz2)$/i, key: 'tar', label: 'Tarball', platform: 'Linux', primary: true },
    { test: /\.dmg$/i, key: 'dmg', label: 'macOS disk image', platform: 'macOS', primary: true },
    { test: /-mac\.zip$|darwin.*\.zip$/i, key: 'maczip', label: 'macOS zip', platform: 'macOS', primary: true },
    { test: /\.exe$/i, key: 'exe', label: 'Windows installer', platform: 'Windows', primary: true },
    { test: /\.msi$/i, key: 'msi', label: 'Windows installer (MSI)', platform: 'Windows', primary: true },
    { test: /\.blockmap$/i, key: 'blockmap', label: 'Updater block map', primary: false },
    { test: /\.ya?ml$/i, key: 'yml', label: 'Updater metadata', primary: false },
    { test: /(sha\d+|checksums?)/i, key: 'sum', label: 'Checksums', primary: false },
    { test: /\.(sig|asc)$/i, key: 'sig', label: 'Signature', primary: false }
  ];

  var ARCHES = [
    { test: /(x86_64|amd64|x64)/i, label: 'x86-64' },
    { test: /(aarch64|arm64)/i, label: 'ARM64' },
    { test: /(armv7l|armhf)/i, label: 'ARMv7' },
    { test: /(i386|i686|ia32)/i, label: '32-bit x86' }
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function classify(name) {
    for (var i = 0; i < KINDS.length; i++) {
      if (KINDS[i].test.test(name)) return KINDS[i];
    }
    return { key: 'other', label: 'File', primary: false };
  }

  function arch(name) {
    for (var i = 0; i < ARCHES.length; i++) {
      if (ARCHES[i].test.test(name)) return ARCHES[i].label;
    }
    return '';
  }

  function formatSize(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes)) return '';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

  function isSafeUrl(url) {
    return typeof url === 'string' && /^https:\/\/(github\.com|objects\.githubusercontent\.com)\//.test(url);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function assetItem(asset, kind) {
    var li = document.createElement('li');
    var left = document.createElement('div');
    var a = el('a', null, asset.name);
    a.href = asset.browser_download_url;
    var kindText = kind.label;
    var archText = arch(asset.name);
    if (archText) kindText += ', ' + archText;
    left.appendChild(a);
    left.appendChild(el('span', 'asset__kind', kindText));
    li.appendChild(left);
    var size = formatSize(asset.size);
    if (size) li.appendChild(el('span', 'asset__meta', size));
    return li;
  }

  function showFailure() {
    var status = $('release-status');
    if (!status) return;
    status.textContent = '';
    status.appendChild(document.createTextNode('Could not load the release list right now. Get the files from '));
    var a = el('a', null, 'the latest release on GitHub');
    a.href = RELEASES_URL;
    status.appendChild(a);
    status.appendChild(document.createTextNode('.'));
  }

  function render(release) {
    if (!release || !Array.isArray(release.assets)) throw new Error('Unexpected API response');

    var assets = release.assets.filter(function (asset) {
      return asset && typeof asset.name === 'string' && isSafeUrl(asset.browser_download_url);
    });
    if (!assets.length) throw new Error('Release has no assets');

    var version = String(release.tag_name || release.name || '').trim();
    var date = formatDate(release.published_at || release.created_at);

    var status = $('release-status');
    status.textContent = '';
    status.appendChild(document.createTextNode('Latest release: '));
    var link = el('a', null, version || 'latest');
    link.href = isSafeUrl(release.html_url) ? release.html_url : RELEASES_URL;
    var strong = document.createElement('strong');
    strong.appendChild(link);
    status.appendChild(strong);
    if (date) {
      status.appendChild(document.createTextNode(', published '));
      var time = el('time', null, date);
      time.setAttribute('datetime', String(release.published_at || release.created_at));
      status.appendChild(time);
    }
    status.appendChild(document.createTextNode('.'));

    var primaryList = $('asset-list');
    var extraList = $('asset-extra-list');
    var primaryCount = 0;
    var extraCount = 0;
    var firstByKind = {};

    // Installable packages first, in KINDS order; extras keep API order.
    var order = {};
    KINDS.forEach(function (k, i) { order[k.key] = i; });
    var classified = assets.map(function (asset) {
      return { asset: asset, kind: classify(asset.name) };
    });
    classified.sort(function (a, b) {
      var oa = order[a.kind.key] != null ? order[a.kind.key] : 999;
      var ob = order[b.kind.key] != null ? order[b.kind.key] : 999;
      return oa - ob;
    });

    classified.forEach(function (entry) {
      var item = assetItem(entry.asset, entry.kind);
      if (entry.kind.primary) {
        primaryList.appendChild(item);
        primaryCount++;
        if (!firstByKind[entry.kind.key]) firstByKind[entry.kind.key] = entry.asset.name;
      } else {
        extraList.appendChild(item);
        extraCount++;
      }
    });

    if (primaryCount) primaryList.hidden = false;
    if (extraCount) $('asset-extra').hidden = false;

    // Put real file names into the install hints.
    var replaced = false;
    var spans = document.querySelectorAll('[data-asset]');
    for (var i = 0; i < spans.length; i++) {
      var name = firstByKind[spans[i].getAttribute('data-asset')];
      if (name) {
        spans[i].textContent = name;
        replaced = true;
      }
    }
    var note = $('install-note');
    if (note && replaced) {
      note.textContent = 'File names above match the latest release. They change with every version.';
    }
  }

  function load() {
    if (!window.fetch) return;
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;

    fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(render)
      .catch(showFailure)
      .then(function () {
        if (timer) clearTimeout(timer);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
