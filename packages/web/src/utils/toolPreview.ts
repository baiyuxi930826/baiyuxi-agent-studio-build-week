const MAX_TOOL_RESULT_LINES = 4;
const MAX_TOOL_RESULT_CHARS = 220;

export function compactToolResultDetail(raw: string): string {
  const trimmed = raw.trimEnd();
  if (trimmed.length === 0) return '(no output)';

  const lines = trimmed.split('\n');
  const hasOverflowLines = lines.length > MAX_TOOL_RESULT_LINES;

  let preview = lines.slice(0, MAX_TOOL_RESULT_LINES).join('\n');

  const truncatedByChars = preview.length > MAX_TOOL_RESULT_CHARS;
  if (truncatedByChars) {
    preview = preview.slice(0, MAX_TOOL_RESULT_CHARS);
  }

  if (hasOverflowLines || truncatedByChars || preview.length < trimmed.length) {
    return `${preview}…`;
  }
  return preview;
}
