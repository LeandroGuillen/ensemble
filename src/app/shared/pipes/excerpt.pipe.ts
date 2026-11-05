import { Pipe, PipeTransform } from '@angular/core';
import { markdownExcerpt, wikiLinksAsText } from '../../core/utils/markdown-excerpt.utils';

/** `{{ body | excerpt:140 }}` — readable plain-text preview of a Markdown body. */
@Pipe({ name: 'excerpt', standalone: true, pure: true })
export class ExcerptPipe implements PipeTransform {
  transform(content: string | null | undefined, maxLength = 160): string {
    return markdownExcerpt(content, maxLength);
  }
}

/** `{{ beat | wikiText }}` — wiki links shown as their labels, other text unchanged. */
@Pipe({ name: 'wikiText', standalone: true, pure: true })
export class WikiTextPipe implements PipeTransform {
  transform(text: string | null | undefined): string {
    return wikiLinksAsText(text);
  }
}
