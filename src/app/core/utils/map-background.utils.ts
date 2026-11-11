/** Uploaded SVGs remain opaque image resources; their markup is never inserted into the DOM. */
export const MAX_MAP_SVG_BYTES = 10 * 1024 * 1024;

export function inspectMapSvg(source: string): { width: number; height: number } {
  if (new Blob([source]).size > MAX_MAP_SVG_BYTES) throw new Error('Choose an SVG smaller than 10 MB.');
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') {
    throw new Error('This file is not a valid SVG image.');
  }
  // Image-mode SVG cannot resolve linked assets. Explain this before accepting a broken map.
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (el.localName !== 'a' && attr.localName === 'href' && attr.value.trim() && !/^(#|data:)/i.test(attr.value.trim())) {
        throw new Error('This SVG links to external resources. Export a self-contained SVG with embedded images.');
      }
    }
  }
  const styles = [...Array.from(doc.querySelectorAll('style')).map(el => el.textContent || ''),
    ...Array.from(doc.querySelectorAll('[style]')).map(el => el.getAttribute('style') || ''),
    ...Array.from(doc.querySelectorAll('*')).flatMap(el => Array.from(el.attributes).map(a => a.value))].join('\n');
  const linkedUrls = Array.from(styles.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi));
  if (/@import\b/i.test(styles) || linkedUrls.some(match => !/^(#|data:)/i.test(match[2].trim())) || /<\?xml-stylesheet\b/i.test(source)) {
    throw new Error('This SVG uses linked styles or images. Export a self-contained SVG.');
  }
  const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box && (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0)) {
    throw new Error('The SVG has an invalid viewBox.');
  }
  const length = (value: string | null): number | undefined => {
    const match = value?.trim().match(/^([\d.]+)(px|pt|pc|mm|cm|in)?$/);
    if (!match) return undefined;
    const units: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
    return Number(match[1]) * (units[match[2] || 'px']);
  };
  const width = box?.[2] ?? length(root.getAttribute('width'));
  const height = box?.[3] ?? length(root.getAttribute('height'));
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width > 1_000_000 || height > 1_000_000) {
    throw new Error('The SVG needs a valid viewBox or explicit width and height (up to 1,000,000 units).');
  }
  return { width, height };
}

export function mapSvgUrl(source: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

export const MAX_MAP_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAP_IMAGE_ACCEPT = '.svg,.png,.jpg,.jpeg,.webp,.gif,image/svg+xml,image/png,image/jpeg,image/webp,image/gif';

export function mapImageExtension(name: string): 'svg' | 'png' | 'jpg' | 'webp' | 'gif' {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'jpeg') return 'jpg';
  if (extension === 'svg' || extension === 'png' || extension === 'jpg' || extension === 'webp' || extension === 'gif') return extension;
  throw new Error('Choose an SVG, PNG, JPEG, WebP or GIF image.');
}

export function readMapImageFile(file: File): Promise<string> {
  const extension = mapImageExtension(file.name);
  const limit = extension === 'svg' ? MAX_MAP_SVG_BYTES : MAX_MAP_IMAGE_BYTES;
  if (file.size > limit) throw new Error(`Choose an image smaller than ${limit / 1024 / 1024} MB.`);
  if (extension === 'svg') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the image.'));
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.onabort = () => reject(new Error('Image upload was cancelled.'));
    reader.readAsDataURL(file);
  });
}

/** Validate the actual bytes and decoder result, rather than trusting the filename or supplied MIME. */
export async function inspectRasterMapImage(source: string, name: string): Promise<{ width: number; height: number; url: string; base64: string }> {
  const extension = mapImageExtension(name);
  if (extension === 'svg') throw new Error('Expected a raster image.');
  const match = source.match(/^data:[^;,]*;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[1].length % 4 !== 0) throw new Error('This file is not a valid image.');
  const base64 = match[1];
  const bytes = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (bytes > MAX_MAP_IMAGE_BYTES) throw new Error('Choose an image smaller than 25 MB.');
  const header = atob(base64.slice(0, 32));
  const valid = extension === 'png' ? header.startsWith('\x89PNG\r\n\x1a\n')
    : extension === 'jpg' ? header.startsWith('\xff\xd8\xff')
    : extension === 'webp' ? header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP'
    : /^GIF8[79]a/.test(header);
  if (!valid) throw new Error('The image contents do not match its file extension.');
  const mime = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
  const url = `data:${mime};base64,${base64}`;
  const image = new Image();
  image.src = url;
  try { await image.decode(); }
  catch { throw new Error('This image is damaged or could not be decoded.'); }
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height || width > 1_000_000 || height > 1_000_000) throw new Error('The image has invalid dimensions.');
  return { width, height, url, base64 };
}
