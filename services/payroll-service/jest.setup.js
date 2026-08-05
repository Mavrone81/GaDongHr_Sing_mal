'use strict';

/**
 * Settle payroll's background work after every test.
 *
 * Publishing a run kicks off a notification fan-out via fireAndForget, which is
 * deliberately not awaited so the HTTP response is not held up. In tests that
 * left an orphaned promise running past the end of the case: Jest tore the
 * module down mid-flight ("Cannot log after tests are done"), and because the
 * work carried on into the NEXT suite it caused intermittent failures in
 * unrelated services — benefits, performance and attendance — roughly one full
 * run in eight.
 *
 * Draining here rather than in each test file means a new suite that publishes
 * a run cannot reintroduce the leak by forgetting to clean up.
 */
afterEach(async () => {
  let routes;
  try {
    routes = require('./src/routes/payroll.routes');
  } catch {
    return; // suite never loaded the router
  }
  if (typeof routes.drainBackgroundWork === 'function') {
    await routes.drainBackgroundWork();
  }
});
