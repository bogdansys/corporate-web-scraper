/**
 * Convert raw HTML to clean, readable text.
 * Used for Tier 3 token reduction: send ~1-2K tokens to Gemini instead of 60KB HTML.
 */

/** Tags whose entire content should be removed (not just the tag). */
const STRIP_TAGS = /(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>|<!--[\s\S]*?-->)/gi;

/** Block-level tags that should introduce a newline when removed. */
const BLOCK_TAGS = /(<\/?(div|p|h[1-6]|li|ul|ol|tr|td|th|br|hr|section|article|header|footer|nav|main|aside|blockquote|figcaption|figure|details|summary|address|pre|table|thead|tbody|tfoot|caption|dl|dt|dd)\b[^>]*\/?>)/gi;

/**
 * Strip HTML to clean text, preserving structure via newlines.
 * Extracts mailto: and tel: links as explicit text.
 */
export function htmlToText(html: string): string {
  let text = html;

  // Extract mailto: and tel: links before stripping tags
  const contactInfo: string[] = [];
  const mailtoRegex = /href=["']mailto:([^"'?]+)/gi;
  const telRegex = /href=["']tel:([^"']+)/gi;

  let match;
  while ((match = mailtoRegex.exec(html)) !== null) {
    contactInfo.push(`Email: ${decodeURIComponent(match[1])}`);
  }
  while ((match = telRegex.exec(html)) !== null) {
    contactInfo.push(`Phone: ${decodeURIComponent(match[1])}`);
  }

  // Extract social media URLs
  const socialRegex = /href=["'](https?:\/\/(?:www\.)?(?:facebook|twitter|x|linkedin|instagram|youtube)\.com\/[^"'\s]+)/gi;
  while ((match = socialRegex.exec(html)) !== null) {
    contactInfo.push(`Social: ${match[1]}`);
  }

  // Strip scripts, styles, SVGs, comments
  text = text.replace(STRIP_TAGS, '');

  // Replace block-level tags with newlines
  text = text.replace(BLOCK_TAGS, '\n');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Normalize whitespace
  text = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  // Append extracted contact info
  if (contactInfo.length > 0) {
    const unique = [...new Set(contactInfo)];
    text += '\n\n--- Extracted Links ---\n' + unique.join('\n');
  }

  // Truncate to ~4000 chars (~1000-1500 tokens) — much smaller than 60KB HTML
  if (text.length > 4000) {
    text = text.slice(0, 4000) + '\n[...truncated]';
  }

  return text;
}
