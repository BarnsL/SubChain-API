// Bounded prompt/context summarization shared by the control-plane patches.
// This intentionally retains only a small, redacted sample of recent text.
// Raw prompts, images, tool bodies, auth values, and binary data are excluded.
const SECRET_PATTERNS = [
  /Bearer\s+[^\s,;]+/gi,
  /\b(?:sk|key|tok|token|api)[-_][A-Za-z0-9._-]{12,}\b/gi,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b[A-Za-z0-9+/_=-]{64,}\b/g,
];

export function redactSummaryText(value, maxChars = 280) {
  let text = String(value ?? '')
    .replace(/https?:\/\/[^\s)\]}]+/gi, '[url]')
    .replace(/(?:[A-Za-z]:\\|\/home\/|\/Users\/)[^\s]+/g, '[path]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[REDACTED]');
  return text.slice(0, Math.max(0, Number(maxChars) || 280));
}

function textFromContent(content, maxChars) {
  if (typeof content === 'string') return redactSummaryText(content, maxChars);
  if (!Array.isArray(content)) return '';
  const pieces = [];
  for (const part of content) {
    if (typeof part === 'string') pieces.push(redactSummaryText(part, maxChars));
    else if (part?.type === 'text' || part?.type === 'input_text') pieces.push(redactSummaryText(part.text ?? part.content, maxChars));
    else if (/image/i.test(String(part?.type || '')) || part?.image_url || part?.source?.type === 'base64') pieces.push('[image]');
    else if (/tool/i.test(String(part?.type || ''))) pieces.push('[tool-content]');
  }
  return pieces.filter(Boolean).join(' ').slice(0, maxChars);
}

export function summarizePromptContext(body = {}, { maxChars = 280, maxItems = 3 } = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const items = [];
  for (const message of messages.slice(-Math.max(1, Math.min(6, Number(maxItems) || 3)))) {
    const summary = textFromContent(message?.content, maxChars);
    if (!summary) continue;
    items.push({ role: ['system','developer','user','assistant'].includes(message?.role) ? message.role : 'unknown', summary });
  }
  return items;
}
