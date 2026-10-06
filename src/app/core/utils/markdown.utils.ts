import * as yaml from "js-yaml";
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Definition, Root, RootContent } from 'mdast';

export interface MarkdownFile<T = any> {
  frontmatter: T;
  content: string;
  raw: string;
}

export interface MarkdownParseResult<T = any> {
  success: boolean;
  data?: MarkdownFile<T>;
  error?: string;
}

const FRONTMATTER_DELIMITER = "---";


/**
 * Parses a markdown file with YAML frontmatter
 */
export function parseMarkdown<T = any>(content: string): MarkdownParseResult<T> {
  try {
    const trimmedContent = content.trim();

    // Check if file starts with frontmatter delimiter
    if (!trimmedContent.startsWith(FRONTMATTER_DELIMITER)) {
      return {
        success: true,
        data: {
          frontmatter: {} as T,
          content: content,
          raw: content,
        },
      };
    }

    // Find the closing delimiter
    const lines = trimmedContent.split("\n");
    let frontmatterEndIndex = -1;

    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === FRONTMATTER_DELIMITER) {
        frontmatterEndIndex = i;
        break;
      }
    }

    if (frontmatterEndIndex === -1) {
      return {
        success: false,
        error: "Frontmatter delimiter not properly closed",
      };
    }

    // Extract frontmatter and content
    const frontmatterLines = lines.slice(1, frontmatterEndIndex);
    const contentLines = lines.slice(frontmatterEndIndex + 1);

    const frontmatterYaml = frontmatterLines.join("\n");
    const markdownContent = contentLines.join("\n").trim();

    // Parse YAML frontmatter
    let frontmatter: T;
    try {
      frontmatter = (yaml.load(frontmatterYaml) as T) || ({} as T);
    } catch (yamlError) {
      return {
        success: false,
        error: `Invalid YAML in frontmatter: ${yamlError}`,
      };
    }

    return {
      success: true,
      data: {
        frontmatter,
        content: markdownContent,
        raw: content,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse markdown: ${error}`,
    };
  }
}

/**
 * Generates markdown content with YAML frontmatter
 */
export function generateMarkdown<T = any>(frontmatter: T, content: string): string {
  try {
    const yamlContent = yaml.dump(frontmatter, {
      indent: 2,
      lineWidth: -1, // Disable line wrapping
      noRefs: true, // Disable references
      sortKeys: false, // Preserve key order
    });

    return `${FRONTMATTER_DELIMITER}\n${yamlContent}${FRONTMATTER_DELIMITER}\n\n${content}`;
  } catch (error) {
    throw new Error(`Failed to generate markdown: ${error}`);
  }
}

/**
 * Validates markdown file structure
 */
export function validateMarkdownStructure(content: string): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  try {
    const parseResult = parseMarkdown(content);

    if (!parseResult.success) {
      errors.push(parseResult.error!);
    }
  } catch (error) {
    errors.push(`Markdown validation failed: ${error}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Extracts frontmatter from markdown content without parsing the full file
 */
export function extractFrontmatter<T = any>(content: string): T | null {
  try {
    const parseResult = parseMarkdown<T>(content);
    return parseResult.success ? parseResult.data!.frontmatter : null;
  } catch {
    return null;
  }
}

/**
 * Extracts content from markdown without frontmatter
 */
export function extractContent(content: string): string {
  try {
    const parseResult = parseMarkdown(content);
    return parseResult.success ? parseResult.data!.content : content;
  } catch {
    return content;
  }
}

/**
 * Checks if content has valid frontmatter
 */
export function hasFrontmatter(content: string): boolean {
  const trimmedContent = content.trim();
  return trimmedContent.startsWith(FRONTMATTER_DELIMITER);
}

/**
 * Converts frontmatter object to YAML string
 */
export function frontmatterToYaml<T = any>(frontmatter: T): string {
  try {
    return yaml.dump(frontmatter, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });
  } catch (error) {
    throw new Error(`Failed to convert frontmatter to YAML: ${error}`);
  }
}

/**
 * Parses YAML string to object
 */
export function yamlToObject<T = any>(yamlString: string): T {
  try {
    return yaml.load(yamlString) as T;
  } catch (error) {
    throw new Error(`Failed to parse YAML: ${error}`);
  }
}

/**
 * Escape HTML special characters to prevent XSS when rendering user markdown.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const markdownParser = unified().use(remarkParse);

function escapeMarkdownAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeMarkdownUrl(value: string): string | null {
  const protocol = value.replace(/[\s\u0000-\u001f\u007f]/g, '').match(/^([a-z][a-z0-9+.-]*):/i)?.[1];
  return protocol && !['http', 'https', 'mailto'].includes(protocol.toLowerCase()) ? null : value;
}

/** Render parsed Markdown blocks and inline formatting without allowing raw HTML. */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return '';
  const root = markdownParser.parse(markdown);
  const definitions = new Map<string, Definition>();
  const collectDefinitions = (node: Root | RootContent): void => {
    if (node.type === 'definition') definitions.set(node.identifier.toLowerCase(), node);
    if ('children' in node) node.children.forEach(collectDefinitions);
  };
  collectDefinitions(root);

  const link = (url: string, label: string, title?: string | null): string => {
    const safeUrl = safeMarkdownUrl(url);
    if (safeUrl === null) return label;
    const titleAttribute = title ? ` title="${escapeMarkdownAttribute(title)}"` : '';
    return `<a href="${escapeMarkdownAttribute(safeUrl)}"${titleAttribute} target="_blank" rel="noopener noreferrer">${label}</a>`;
  };
  const render = (node: Root | RootContent): string => {
    const children = () => 'children' in node ? node.children.map(render).join('') : '';
    switch (node.type) {
      case 'root': return children();
      case 'heading': return `<h${node.depth}>${children()}</h${node.depth}>`;
      case 'paragraph': return `<p>${children()}</p>`;
      case 'text': return escapeHtml(node.value).replace(/~~([^~\n]+)~~/g, '<del>$1</del>').replace(/\n/g, '<br>');
      case 'emphasis': return `<em>${children()}</em>`;
      case 'strong': return `<strong>${children()}</strong>`;
      case 'inlineCode': return `<code>${escapeHtml(node.value)}</code>`;
      case 'code': return `<pre><code>${escapeHtml(node.value)}</code></pre>`;
      case 'break': return '<br>';
      case 'thematicBreak': return '<hr>';
      case 'blockquote': return `<blockquote>${children()}</blockquote>`;
      case 'list': {
        const tag = node.ordered ? 'ol' : 'ul';
        const start = node.ordered && node.start != null && node.start !== 1 ? ` start="${node.start}"` : '';
        return `<${tag}${start}>${children()}</${tag}>`;
      }
      case 'listItem': return `<li>${children()}</li>`;
      case 'link': return link(node.url, children(), node.title);
      case 'linkReference': {
        const definition = definitions.get(node.identifier.toLowerCase());
        return definition ? link(definition.url, children(), definition.title) : children();
      }
      case 'image': {
        const url = safeMarkdownUrl(node.url);
        return url === null ? escapeHtml(node.alt || '') : `<img src="${escapeMarkdownAttribute(url)}" alt="${escapeMarkdownAttribute(node.alt || '')}">`;
      }
      case 'imageReference': {
        const definition = definitions.get(node.identifier.toLowerCase());
        const url = definition && safeMarkdownUrl(definition.url);
        return url ? `<img src="${escapeMarkdownAttribute(url)}" alt="${escapeMarkdownAttribute(node.alt || '')}">` : escapeHtml(node.alt || '');
      }
      case 'html': return escapeHtml(node.value);
      case 'definition': return '';
      default: return children();
    }
  };
  return render(root);
}
