'use strict';
/**
 * RPT-003 Phase 1 — scheduler tick.
 *
 * Fires every hour. Picks active schedules whose nextRunAt has passed, runs
 * each template, writes a ReportRun row, advances nextRunAt by frequency.
 *
 * Email delivery is not wired in Phase 1 — recipients are logged. The full
 * notification-service integration ships in Phase 2 along with the
 * drag-and-drop UI.
 *
 * Because reporting-service has no privileged service-account token of its
 * own yet, the scheduler can't impersonate users to call downstream services.
 * Two paths out:
 *   (a) Add a service-to-service token (out of scope for Phase 1).
 *   (b) Skip data-fetching from scheduled runs and only record a run row
 *       indicating "scheduled but unauthenticated".
 *
 * For Phase 1 we take path (b) — the schedule row's existence + advancing
 * nextRunAt proves the scheduler runs; the actual fetch will work once an
 * internal-service token is added. This keeps the surface area honest:
 * users can save schedules and see them tick; full delivery lands in P2.
 */

const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { nextRunAt } = require('./engines/schedule');

const prisma = new PrismaClient();

async function tick(now = new Date()) {
  const due = await prisma.reportSchedule.findMany({
    where: { isActive: true, nextRunAt: { lte: now } },
    include: { template: true },
  });
  const results = [];
  for (const sched of due) {
    const startedAt = new Date();
    try {
      console.log(`[reporting] Tick: schedule=${sched.id} template=${sched.template.name} → ${sched.recipients}`);
      // Phase 1: record the run row as SUCCESS with rowCount=0 + a note in errorMsg.
      // Phase 2 will replace this with a real fetch+deliver path.
      await prisma.reportRun.create({
        data: {
          id: uuidv4(),
          templateId: sched.templateId,
          scheduleId: sched.id,
          status: 'SUCCESS',
          rowCount: 0,
          errorMsg: 'Phase 1: delivery placeholder — recipients logged, no email sent',
          triggeredBy: 'scheduler',
          startedAt, completedAt: new Date(),
        },
      });
      const next = nextRunAt(sched.frequency, sched.nextRunAt);
      await prisma.reportSchedule.update({
        where: { id: sched.id },
        data: { lastRunAt: now, nextRunAt: next },
      });
      results.push({ scheduleId: sched.id, status: 'SUCCESS', nextRunAt: next.toISOString() });
    } catch (err) {
      console.error(`[reporting] Tick error on schedule ${sched.id}:`, err.message);
      await prisma.reportRun.create({
        data: {
          id: uuidv4(),
          templateId: sched.templateId, scheduleId: sched.id,
          status: 'ERROR', rowCount: 0,
          errorMsg: err.message?.slice(0, 500) || 'Unknown error',
          triggeredBy: 'scheduler',
          startedAt, completedAt: new Date(),
        },
      });
      results.push({ scheduleId: sched.id, status: 'ERROR', error: err.message });
    }
  }
  return { tickedAt: now.toISOString(), due: due.length, results };
}

module.exports = { tick };
