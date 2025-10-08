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

export class MarkdownUtils {
  private static readonly FRONTMATTER_DELIMITER = "---";

  /**
   * Parses a markdown file with YAML frontmatter
   */
  static parseMarkdown<T = any>(content: string): MarkdownParseResult<T> {
    try {
      const trimmedContent = content.trim();

      // Check if file starts with frontmatter delimiter
      if (!trimmedContent.startsWith(this.FRONTMATTER_DELIMITER)) {
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
        if (lines[i].trim() === this.FRONTMATTER_DELIMITER) {
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
  static generateMarkdown<T = any>(frontmatter: T, content: string): string {
    try {
      const yamlContent = yaml.dump(frontmatter, {
        indent: 2,
        lineWidth: -1, // Disable line wrapping
        noRefs: true, // Disable references
        sortKeys: false, // Preserve key order
      });

      return `${this.FRONTMATTER_DELIMITER}\n${yamlContent}${this.FRONTMATTER_DELIMITER}\n\n${content}`;
    } catch (error) {
      throw new Error(`Failed to generate markdown: ${error}`);
    }
  }

  /**
   * Validates markdown file structure
   */
  static validateMarkdownStructure(content: string): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    try {
      const parseResult = this.parseMarkdown(content);

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
  static extractFrontmatter<T = any>(content: string): T | null {
    try {
      const parseResult = this.parseMarkdown<T>(content);
      return parseResult.success ? parseResult.data!.frontmatter : null;
    } catch {
      return null;
    }
  }

  /**
   * Extracts content from markdown without frontmatter
   */
  static extractContent(content: string): string {
    try {
      const parseResult = this.parseMarkdown(content);
      return parseResult.success ? parseResult.data!.content : content;
    } catch {
      return content;
    }
  }

  /**
   * Checks if content has valid frontmatter
   */
  static hasFrontmatter(content: string): boolean {
    const trimmedContent = content.trim();
    return trimmedContent.startsWith(this.FRONTMATTER_DELIMITER);
  }

  /**
   * Converts frontmatter object to YAML string
   */
  static frontmatterToYaml<T = any>(frontmatter: T): string {
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
  static yamlToObject<T = any>(yamlString: string): T {
    try {
      return yaml.load(yamlString) as T;
    } catch (error) {
      throw new Error(`Failed to parse YAML: ${error}`);
    }
  }
}
