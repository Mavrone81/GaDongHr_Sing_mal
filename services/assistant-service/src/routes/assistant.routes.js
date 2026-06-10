'use strict';

const express = require('express');
const { authenticate } = require('/app/shared/auth-middleware');
const { TOOL_SCHEMAS, runTool } = require('../tools');
const { runChat, isConfigured, available } = require('../llm');
const { maskSensitive } = require('../mask');

const router = express.Router();

const MAX_HISTORY = 20; // cap conversation turns sent to the model

// Per-tenant AI provider: the platform operator sets each tenant to 'ollama'
// (default, local) or 'claude'. Resolved from admin-service, cached briefly.
const ADMIN_URL = process.env.ADMIN_SERVICE_URL || 'http://admin-service:4016';
const _provCache = new Map();
const PROV_TTL = Number(process.env.AI_PROVIDER_TTL_MS || 60000);
async function resolveProvider(tenantId) {
  const c = tenantId && _provCache.get(tenantId);
  if (c && Date.now() - c.at < PROV_TTL) return c.provider;
  let stored = 'ollama';
  try {
    if (tenantId) {
      const r = await fetch(`${ADMIN_URL}/platform/ai-provider/${tenantId}`, { headers: { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY || '' } });
      if (r.ok) stored = (await r.json()).provider || 'ollama';
    }
  } catch { /* control plane down -> default */ }
  let provider = stored === 'claude' ? 'anthropic' : 'openai';
  if (!available(provider)) provider = available('openai') ? 'openai' : 'anthropic';
  if (tenantId) _provCache.set(tenantId, { at: Date.now(), provider });
  return provider;
}

function systemPrompt(user) {
  const name = user.name || 'the user';
  const role = user.role || 'EMPLOYEE';
  const empId = user.employeeId || '(no employee record linked)';
  return [
    `You are "Vork", the in-app HR assistant for the Vorkhive HRMS.`,
    `You are talking to ${name} (role: ${role}, employeeId: ${empId}).`,
    ``,
    `WHAT YOU CAN DO`,
    `- Answer questions about HR data — leave, claims, payslips, profile, appraisals,`,
    `  training, team/approvers — by calling the provided tools.`,
    `- Help the user apply for leave or submit a claim (write actions).`,
    ``,
    `HARD RULES`,
    `- ALWAYS get real data from a tool before answering a data question. Never invent`,
    `  numbers, dates, balances, names or statuses. If a tool returns no data, say so.`,
    `- You can ONLY ever see what this user is permitted to see. The tools run with the`,
    `  user's own permissions, so if a tool reports "not allowed"/forbidden, tell the`,
    `  user plainly that they don't have access — do not try to work around it.`,
    `- For write actions (apply_leave, submit_claim): pass the leave type / category by`,
    `  NAME and the dates in WHATEVER format the user gave (e.g. "10 Jun 2026", "tomorrow").`,
    `  The tools resolve ids and normalise dates for you — do NOT ask the user to reformat`,
    `  dates or to look up an id. Briefly restate what you'll submit, then submit once they`,
    `  confirm. If a tool reports it couldn't match a type, show the user the available`,
    `  options and let them pick — never just say "not available" and stop.`,
    `- Be flexible and understanding: interpret casual phrasing, abbreviations and natural`,
    `  dates. Never reject or block a request purely because of formatting.`,
    `- Be concise and friendly. Use the user's own role/employeeId for "my ..." questions;`,
    `  do not ask the user for their employee id.`,
    `- Money is in SGD.`,
  ].join('\n');
}

// POST /assistant/chat  { messages: [{role:'user'|'assistant', content:string}] }
router.post('/chat', authenticate, async (req, res, next) => {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ error: 'The assistant is not configured yet. An administrator needs to set an AI provider key (GROQ_API_KEY or ANTHROPIC_API_KEY).' });
    }
    const authHeader = req.headers['authorization'];
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!incoming || incoming.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const messages = incoming
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'The last message must be from the user.' });
    }

    // Pick the tenant's provider; on the external (Claude) path, redact PII from
    // every tool result before it leaves the host.
    const provider = await resolveProvider(req.user?.tenantId);
    const exec = async (name, input) => {
      const result = await runTool(name, input, authHeader, req.user);
      return provider === 'anthropic' ? maskSensitive(result) : result;
    };

    const reply = await runChat({
      provider,
      system: systemPrompt(req.user),
      messages,
      tools: TOOL_SCHEMAS,
      exec,
    });

    return res.json({ reply: reply || "Sorry, I couldn't complete that. Please try rephrasing." });
  } catch (err) {
    console.error('[assistant] chat error:', err?.status || '', err?.message || err, err?.detail || '');
    if (err?.status === 401) return res.status(502).json({ error: 'The assistant could not authenticate to its AI provider. Check the provider API key.' });
    return res.status(502).json({ error: 'The assistant had a problem answering. Please try again.' });
  }
});

module.exports = router;
