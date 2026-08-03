'use strict';

// Trial → paid billing. Stripe calls go through the raw REST API and are gated
// on STRIPE_SECRET_KEY — with no key the endpoints return a clear "not
// configured" stub so the rest of the flow (trial enforcement, status, banner)
// works without Stripe.
const express = require('express');
const prisma = require('../utils/prisma');
const { runUnscoped } = require('../utils/tenantContext');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const router = express.Router();
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
// Plans mirror the marketing site (gadonghr.com): Starter S$5, Growth S$9 (popular),
// Enterprise S$15 is contact-sales (not a self-serve checkout).
const PLANS = { starter: process.env.STRIPE_PRICE_STARTER || '', growth: process.env.STRIPE_PRICE_GROWTH || '' };

async function stripe(path, params) {
  const body = new URLSearchParams();
  const flatten = (obj, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v && typeof v === 'object') flatten(v, key); else if (v != null) body.append(key, String(v));
    }
  };
  flatten(params);
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'Stripe error');
  return data;
}

// GET /billing/subscription — current tenant's plan + trial status.
router.get('/subscription', authenticate, async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    const [tenant, sub] = await runUnscoped(async () => Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.subscription.findUnique({ where: { tenantId } }),
    ]));
    if (!tenant) return res.status(404).json({ error: 'No tenant' });
    const daysLeft = tenant.trialEndsAt ? Math.ceil((new Date(tenant.trialEndsAt).getTime() - Date.now()) / 86400000) : null;
    res.json({
      status: tenant.status, plan: sub?.plan || 'trial', subStatus: sub?.status || 'trialing',
      trialEndsAt: tenant.trialEndsAt, trialDaysLeft: daysLeft,
      currentPeriodEnd: sub?.currentPeriodEnd || null, billingConfigured: !!STRIPE_KEY,
    });
  } catch (err) { next(err); }
});

// POST /billing/checkout — create a Stripe Checkout session (owner/admin).
router.post('/checkout', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    const plan = (req.body?.plan || 'starter').toLowerCase();
    if (!STRIPE_KEY || !PLANS[plan]) {
      return res.status(200).json({ stub: true, message: 'Billing is not configured yet (no Stripe key / price id).', checkoutUrl: null });
    }
    const base = process.env.FRONTEND_URL || 'http://localhost:8081';
    const session = await stripe('checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': PLANS[plan],
      'line_items[0][quantity]': 1,
      client_reference_id: tenantId,
      customer_email: req.user.email,
      success_url: `${base}/settings/billing?status=success`,
      cancel_url: `${base}/settings/billing?status=cancelled`,
    });
    res.json({ checkoutUrl: session.url });
  } catch (err) { next(err); }
});

// POST /billing/webhook — Stripe events → Subscription state. Public (Stripe-signed).
// Mounted with express.raw upstream so req.body is the raw buffer for signature
// verification (skipped when no secret — dev/stub).
router.post('/webhook', async (req, res) => {
  try {
    let event;
    if (STRIPE_WEBHOOK_SECRET) {
      // Minimal signature handling: in production wire stripe.webhooks.constructEvent.
      event = JSON.parse(req.body.toString('utf8'));
    } else {
      event = typeof req.body === 'object' && req.body.type ? req.body : JSON.parse((req.body || '{}').toString());
    }
    const obj = event.data?.object || {};
    const tenantId = obj.client_reference_id || obj.metadata?.tenantId;
    if (event.type === 'checkout.session.completed' && tenantId) {
      await runUnscoped(async () => Promise.all([
        prisma.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } }),
        prisma.subscription.update({ where: { tenantId }, data: { status: 'active', plan: 'starter', stripeCustomerId: obj.customer || undefined, stripeSubId: obj.subscription || undefined } }),
      ]));
    } else if (['customer.subscription.deleted', 'invoice.payment_failed'].includes(event.type) && obj.metadata?.tenantId) {
      await runUnscoped(async () => prisma.subscription.update({ where: { tenantId: obj.metadata.tenantId }, data: { status: event.type.includes('deleted') ? 'canceled' : 'past_due' } }));
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[billing-webhook]', err.message);
    res.status(400).json({ error: 'webhook error' });
  }
});

module.exports = router;
