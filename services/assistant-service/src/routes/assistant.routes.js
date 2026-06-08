'use strict';

const express = require('express');
const { authenticate } = require('/app/shared/auth-middleware');
const { TOOL_SCHEMAS, runTool } = require('../tools');
const { runChat, isConfigured } = require('../llm');

const router = express.Router();

const MAX_HISTORY = 20; // cap conversation turns sent to the model

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

    const reply = await runChat({
      system: systemPrompt(req.user),
      messages,
      tools: TOOL_SCHEMAS,
      exec: (name, input) => runTool(name, input, authHeader, req.user),
    });

    return res.json({ reply: reply || "Sorry, I couldn't complete that. Please try rephrasing." });
  } catch (err) {
    console.error('[assistant] chat error:', err?.status || '', err?.message || err, err?.detail || '');
    if (err?.status === 401) return res.status(502).json({ error: 'The assistant could not authenticate to its AI provider. Check the provider API key.' });
    return res.status(502).json({ error: 'The assistant had a problem answering. Please try again.' });
  }
});

module.exports = router;
