import { Location } from '../interfaces/location.interface';
import { renderWikiLinkMarkdown, resolveWikiLink } from './wiki-links.utils';

export function resolveLocationLink(target: string, locations: Location[], locationsFolder = 'locations'): Location | undefined {
  return resolveWikiLink(target, locations, locationsFolder);
}

export function renderLocationMarkdown(content: string, locations: Location[], locationsFolder = 'locations'): { html: string; missingLinks: string[] } {
  return renderWikiLinkMarkdown(content, locations, { folder: locationsFolder, route: 'location', singular: 'Location' });
}

export function locationMarkdownToHtml(content: string, locations: Location[], locationsFolder = 'locations'): string {
  return renderLocationMarkdown(content, locations, locationsFolder).html;
}
