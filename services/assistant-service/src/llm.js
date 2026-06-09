'use strict';

/**
 * Provider-agnostic LLM driver for the HR assistant.
 *
 * Supports two backends behind one interface so the rest of the service never
 * changes when you swap providers:
 *   - "openai"  : any OpenAI-compatible /chat/completions endpoint — Groq
 *                 (free), OpenRouter, Together, a local Ollama/LM Studio, or
 *                 OpenAI itself. Tool-calling uses the OpenAI function schema.
 *   - "anthropic": Claude via the official SDK (tool-use blocks).
 *
 * Selection: explicit ASSISTANT_PROVIDER wins; otherwise auto-detect from which
 * key is present (Groq/OpenAI key -> openai, else Anthropic key -> anthropic).
 */

const OPENAI_KEY = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL
  || (process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1');
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

function detectProvider() {
  const explicit = (process.env.ASSISTANT_PROVIDER || '').toLowerCase();
  if (explicit === 'openai' || explicit === 'groq') return OPENAI_KEY ? 'openai' : null;
  if (explicit === 'anthropic') return ANTHROPIC_KEY ? 'anthropic' : null;
  if (OPENAI_KEY) return 'openai';
  if (ANTHROPIC_KEY) return 'anthropic';
  return null;
}

const PROVIDER = detectProvider();

function defaultModel() {
  if (process.env.ASSISTANT_MODEL) return process.env.ASSISTANT_MODEL;
  if (PROVIDER === 'openai') return process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';
  return 'claude-haiku-4-5';
}

const MODEL = defaultModel();
const MAX_ROUNDS = 6;
const MAX_TOKENS = 1024;

function info() {
  return { provider: PROVIDER, model: PROVIDER ? MODEL : null, configured: !!PROVIDER };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// POST /chat/completions with retry on 429 (free tiers have tight tokens/min
// limits). Respects Retry-After / "try again in Xs" hints, capped.
async function postChat(body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();

    const text = await res.text().catch(() => '');
    if (res.status === 429 && attempt < 3) {
      let waitMs = parseFloat(res.headers.get('retry-after')) * 1000;
      if (!waitMs || Number.isNaN(waitMs)) {
        const m = text.match(/try again in ([\d.]+)\s*s/i);
        waitMs = m ? parseFloat(m[1]) * 1000 : 4000;
      }
      await sleep(Math.min(Math.max(waitMs, 1000) + 400, 20000));
      continue;
    }
    const err = new Error(`LLM provider error (${res.status})`);
    err.status = res.status;
    err.detail = text.slice(0, 500);
    throw err;
  }
  const err = new Error('LLM provider rate-limited (429) after retries');
  err.status = 429;
  throw err;
}

// ── OpenAI-compatible (Groq etc.) ──────────────────────────────────────────
async function runOpenAI({ system, messages, tools, exec }) {
  const oaiTools = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema || { type: 'object', properties: {} } },
  }));
  const msgs = [{ role: 'system', content: system }, ...messages];

  let reply = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const data = await postChat({ model: MODEL, max_tokens: MAX_TOKENS, temperature: 0.2, messages: msgs, tools: oaiTools, tool_choice: 'auto' });
    const msg = data.choices?.[0]?.message;
    if (!msg) break;
    if (msg.content) reply = msg.content;

    const calls = msg.tool_calls || [];
    if (calls.length === 0) break;

    // Echo the assistant turn (with its tool_calls), then answer each call.
    msgs.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const c of calls) {
      let args = {};
      try { args = c.function?.arguments ? JSON.parse(c.function.arguments) : {}; } catch { args = {}; }
      const result = await exec(c.function?.name, args);
      msgs.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }
  return reply;
}

// ── Anthropic (Claude) ─────────────────────────────────────────────────────
let _anthropic = null;
function anthropicClient() {
  if (_anthropic) return _anthropic;
  const Anthropic = require('@anthropic-ai/sdk');
  _anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  return _anthropic;
}

async function runAnthropic({ system, messages, tools, exec }) {
  const client = anthropicClient();
  const anthTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const msgs = messages.map((m) => ({ role: m.role, content: m.content }));

  let reply = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.messages.create({ model: MODEL, max_tokens: MAX_TOKENS, system, tools: anthTools, messages: msgs });
    const textOut = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (textOut) reply = textOut;
    if (response.stop_reason !== 'tool_use') break;

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    msgs.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const tu of toolUses) {
      const result = await exec(tu.name, tu.input);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result), is_error: result && result.ok === false });
    }
    msgs.push({ role: 'user', content: results });
  }
  return reply;
}

/**
 * Run a full chat turn (model + tool loop).
 * @param {{system:string, messages:Array<{role,content}>, tools:Array, exec:Function}} args
 * @returns {Promise<string>} the assistant's final text
 */
async function runChat(args) {
  if (PROVIDER === 'openai') return runOpenAI(args);
  if (PROVIDER === 'anthropic') return runAnthropic(args);
  throw Object.assign(new Error('No LLM provider configured'), { code: 'NOT_CONFIGURED' });
}

module.exports = { runChat, info, isConfigured: () => !!PROVIDER };
