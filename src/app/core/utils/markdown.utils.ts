import * as yaml from "js-yaml";

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

/**
 * Convert a limited markdown subset to HTML (headers, emphasis, code, links,
 * strikethrough, paragraphs). Input is HTML-escaped first.
 * Callers that bind to `[innerHTML]` should still sanitize (e.g. DomSanitizer).
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown) {
    return '';
  }

  let html = escapeHtml(markdown);

  // Code blocks (must come before inline code and other formatting)
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // Inline code (must come before bold/italic)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic (simple approach - single asterisk/underscore)
  html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Line breaks - convert double newlines to paragraphs
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs
    .map((para) => {
      para = para.trim();
      if (!para) {
        return '';
      }
      // Convert single newlines to <br> within paragraphs
      para = para.replace(/\n/g, '<br>');
      // Don't wrap if already has block-level tags
      if (/^<(h[1-6]|pre|ul|ol)/.test(para)) {
        return para;
      }
      return `<p>${para}</p>`;
    })
    .join('');

  return html;
}
