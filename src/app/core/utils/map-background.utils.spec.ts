import { inspectMapSvg, mapSvgUrl, MAX_MAP_SVG_BYTES, MAP_IMAGE_ACCEPT, mapImageExtension, readMapImageFile, inspectRasterMapImage } from './map-background.utils';

describe('SVG map uploads', () => {
  const svg = (attrs: string, body = '') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
  it('accepts offset viewBoxes, explicit dimensions and physical units without changing the source', () => {
    expect(inspectMapSvg(svg('viewBox="-400 100 1200 800"'))).toEqual({ width: 1200, height: 800 });
    expect(inspectMapSvg(svg('width="10cm" height="5cm"')).width).toBeCloseTo(377.95, 2);
    const source = svg('width="800" height="400"', '<text>山 &amp; sea</text>');
    expect(decodeURIComponent(mapSvgUrl(source).split(',')[1])).toBe(source);
  });
  it('rejects malformed files, missing or invalid dimensions and oversized uploads', () => {
    for (const source of ['<svg', '<html/>', svg(''), svg('viewBox="0 0 -1 50"'), svg('width="100%" height="20%"'), svg('viewBox="0 0 1e10 5"')]) {
      expect(() => inspectMapSvg(source)).toThrow();
    }
    expect(() => inspectMapSvg(' '.repeat(MAX_MAP_SVG_BYTES + 1))).toThrowError(/10 MB/);
  });
  it('requires self-contained artwork while allowing embedded images and local definitions', () => {
    for (const body of ['<image href="coast.png"/>', '<image href="https://example.com/a.png"/>', '<style>path {fill:url(texture.svg)}</style>', '<style>@import "font.css";</style>']) {
      expect(() => inspectMapSvg(svg('viewBox="0 0 100 50"', body))).toThrowError(/self-contained/);
    }
    expect(() => inspectMapSvg(svg('viewBox="0 0 100 50"', '<use href="#coast"/><image href="data:image/png;base64,AA=="/><path fill="url(#sea)"/>'))).not.toThrow();
  });
});


describe('Raster map uploads', () => {
  it('accepts PNG, JPEG, WebP and GIF, with actual dimensions and unchanged bytes', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 4;
    for (const [extension, mime] of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp']]) {
      const url = canvas.toDataURL(mime);
      const image = await inspectRasterMapImage(url, `map.${extension}`);
      expect(image.width).toBe(8);
      expect(image.height).toBe(4);
      expect(image.url).toBe(url);
      expect(image.base64).toBe(url.split(',')[1]);
    }
    const gif = await inspectRasterMapImage('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'map.gif');
    expect(gif.width).toBe(1);
    expect(gif.height).toBe(1);
  });

  it('rejects unsupported files, mismatched signatures and damaged images', async () => {
    expect(() => mapImageExtension('map.pdf')).toThrow();
    await expectAsync(inspectRasterMapImage('data:image/png;base64,' + btoa('<svg/>'), 'map.png')).toBeRejected();
    await expectAsync(inspectRasterMapImage('data:image/png;base64,' + btoa('\x89PNG\r\n\x1a\n' + 'broken data'), 'map.png')).toBeRejected();
  });

  it('reads raster files as base64 even without a supplied MIME type and exposes the complete picker filter', async () => {
    const canvas = document.createElement('canvas');
    const url = canvas.toDataURL('image/png');
    const file = new File([Uint8Array.from(atob(url.split(',')[1]), char => char.charCodeAt(0))], 'map.PNG');
    const result = await readMapImageFile(file);
    expect((await inspectRasterMapImage(result, file.name)).url).toBe(url);
    for (const extension of ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']) expect(MAP_IMAGE_ACCEPT).toContain(extension);
  });
});
