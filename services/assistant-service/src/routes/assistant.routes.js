'use strict';

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { authenticate } = require('/app/shared/auth-middleware');
const { TOOL_SCHEMAS, runTool } = require('../tools');

const router = express.Router();

const MODEL = process.env.ASSISTANT_MODEL || 'claude-haiku-4-5';
const MAX_TOOL_ROUNDS = 6;          // safety cap on the agentic loop per turn
const MAX_HISTORY = 20;             // cap conversation turns sent to the model

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

function systemPrompt(user) {
  const name = user.name || 'the user';
  const role = user.role || 'EMPLOYEE';
  const empId = user.employeeId || '(no employee record linked)';
  return [
    `You are "Vork", the in-app HR assistant for the Vorkhive HRMS.`,
    `You are talking to ${name} (role: ${role}, employeeId: ${empId}).`,
    ``,
    `WHAT YOU CAN DO`,
    `- Answer questions about HR data — leave, claims, payslips, attendance, profile,`,
    `  appraisals, training, team/approvers — by calling the provided tools.`,
    `- Help the user apply for leave or submit a claim (write actions).`,
    ``,
    `HARD RULES`,
    `- ALWAYS get real data from a tool before answering a data question. Never invent`,
    `  numbers, dates, balances, names or statuses. If a tool returns no data, say so.`,
    `- You can ONLY ever see what this user is permitted to see. The tools run with the`,
    `  user's own permissions, so if a tool reports "not allowed"/forbidden, tell the`,
    `  user plainly that they don't have access — do not try to work around it.`,
    `- For write actions (apply_leave, submit_claim): first look up the needed ids`,
    `  (leave types / claim categories), then RESTATE the exact details and ASK the user`,
    `  to confirm. Only call the action tool after the user confirms.`,
    `- Be concise and friendly. Use the user's own role/employeeId for "my ..." questions;`,
    `  do not ask the user for their employee id.`,
    `- Money is in SGD. Dates are YYYY-MM-DD.`,
  ].join('\n');
}

// POST /assistant/chat  { messages: [{role:'user'|'assistant', content:string}] }
router.post('/chat', authenticate, async (req, res, next) => {
  try {
    if (!anthropic) {
      return res.status(503).json({ error: 'The assistant is not configured yet. An administrator needs to set ANTHROPIC_API_KEY.' });
    }
    const authHeader = req.headers['authorization'];
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!incoming || incoming.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Sanitise + cap the history. Only text content from user/assistant.
    const messages = incoming
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'The last message must be from the user.' });
    }

    const system = systemPrompt(req.user);
    let reply = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system,
        tools: TOOL_SCHEMAS,
        messages,
      });

      // Collect any text the model produced this round.
      const textOut = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (textOut) reply = textOut;

      if (response.stop_reason !== 'tool_use') break;

      // Execute every requested tool with the caller's own token (RBAC scoped).
      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const tu of toolUses) {
        const result = await runTool(tu.name, tu.input, authHeader, req.user);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
          is_error: result && result.ok === false,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    if (!reply) reply = "Sorry, I couldn't complete that. Please try rephrasing.";
    return res.json({ reply });
  } catch (err) {
    // Don't leak provider internals to the client.
    console.error('[assistant] chat error:', err?.message || err);
    if (err?.status === 401) return res.status(502).json({ error: 'The assistant could not authenticate to its AI provider. Check ANTHROPIC_API_KEY.' });
    return res.status(502).json({ error: 'The assistant had a problem answering. Please try again.' });
  }
});

module.exports = router;
