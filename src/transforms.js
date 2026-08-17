const ANTHROPIC_IDENTITY = 'You are Claude Code, Anthropic\'s official CLI for Claude.';

const NEWEST_ANTHROPIC_MODELS = new Set([
  'claude-fable-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-7',
]);

export function authHeader(credential, link) {
  if (!credential) return {};
  if (link.authType === 'oauth-bearer') {
    return { Authorization: `Bearer ${credential.token}` };
  }
  if (link.transform === 'anthropic') {
    return { 'x-api-key': credential.token };
  }
  return { Authorization: `Bearer ${credential.token}` };
}

export function transformRequest(body, link) {
  if (link.transform === 'anthropic') return toAnthropicRequest(body, link);
  if (link.transform === 'codex') return toCodexRequest(body, link);
  return { endpoint: '/chat/completions', body: { ...body, model: link.model }, headers: {} };
}

function toAnthropicRequest(body, link) {
  const systemBlocks = [];
  const messages = [];

  systemBlocks.push({ type: 'text', text: ANTHROPIC_IDENTITY });

  for (const msg of body.messages || []) {
    if (msg.role === 'system') {
      systemBlocks.push({ type: 'text', text: msg.content });
    } else {
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: typeof msg.content === 'string' ? msg.content : msg.content,
      });
    }
  }

  const anthropicBody = {
    model: link.model,
    messages,
    system: systemBlocks,
    max_tokens: body.max_tokens || 4096,
  };

  if (body.stream) anthropicBody.stream = true;

  if (!NEWEST_ANTHROPIC_MODELS.has(link.model)) {
    if (body.temperature !== undefined) anthropicBody.temperature = body.temperature;
    if (body.top_p !== undefined) anthropicBody.top_p = body.top_p;
    if (body.top_k !== undefined) anthropicBody.top_k = body.top_k;
  }

  if (body.stop) anthropicBody.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];

  const headers = {
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };

  return { endpoint: '/messages', body: anthropicBody, headers };
}

function toCodexRequest(body, link) {
  const input = [];
  for (const msg of body.messages || []) {
    if (msg.role === 'system') {
      input.push({ role: 'developer', content: msg.content });
    } else {
      input.push({ role: msg.role, content: msg.content });
    }
  }

  const codexBody = {
    model: link.model,
    input,
  };

  if (body.max_tokens) codexBody.max_output_tokens = body.max_tokens;
  if (body.temperature !== undefined) codexBody.temperature = body.temperature;
  if (body.stream) codexBody.stream = true;

  return { endpoint: '/responses', body: codexBody, headers: {} };
}

export function transformResponse(responseText, link) {
  if (!link.transform) return responseText;
  if (link.transform === 'anthropic') return fromAnthropicResponse(responseText);
  if (link.transform === 'codex') return fromCodexResponse(responseText);
  return responseText;
}

function fromAnthropicResponse(text) {
  const data = JSON.parse(text);

  let content = '';
  if (Array.isArray(data.content)) {
    content = data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  return JSON.stringify({
    id: data.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: data.stop_reason === 'end_turn' ? 'stop'
        : data.stop_reason === 'max_tokens' ? 'length'
        : data.stop_reason || 'stop',
    }],
    usage: {
      prompt_tokens: data.usage?.input_tokens || 0,
      completion_tokens: data.usage?.output_tokens || 0,
      total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    },
  });
}

function fromCodexResponse(text) {
  const data = JSON.parse(text);

  let content = '';
  if (typeof data.output === 'string') {
    content = data.output;
  } else if (Array.isArray(data.output)) {
    content = data.output
      .filter((o) => o.type === 'message' && o.role === 'assistant')
      .map((o) => typeof o.content === 'string' ? o.content
        : Array.isArray(o.content) ? o.content.filter((c) => c.type === 'output_text').map((c) => c.text).join('') : '')
      .join('');
  }

  return JSON.stringify({
    id: data.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: data.status === 'completed' ? 'stop' : 'stop',
    }],
    usage: {
      prompt_tokens: data.usage?.input_tokens || 0,
      completion_tokens: data.usage?.output_tokens || 0,
      total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    },
  });
}

export function transformStreamChunk(chunk, link) {
  if (!link.transform) return chunk;
  if (link.transform === 'anthropic') return fromAnthropicStreamChunk(chunk);
  return chunk;
}

function fromAnthropicStreamChunk(raw) {
  const lines = raw.split('\n');
  const output = [];

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const json = line.slice(6).trim();
    if (json === '[DONE]') {
      output.push('data: [DONE]\n\n');
      continue;
    }
    try {
      const event = JSON.parse(json);
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        output.push(`data: ${JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null }],
        })}\n\n`);
      } else if (event.type === 'message_stop') {
        output.push(`data: ${JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`);
        output.push('data: [DONE]\n\n');
      }
    } catch {}
  }

  return output.join('');
}
