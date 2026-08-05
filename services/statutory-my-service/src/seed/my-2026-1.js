'use strict';

/**
 * PROVISIONAL seed for Malaysian statutory tables.
 *
 * ⚠ THIS SEED CONTAINS NO RATE DATA, AND THAT IS DELIBERATE.
 *
 * PRD §A7.1–A7.2 require every seeded EPF, SOCSO, EIS, PCB and HRD Corp figure
 * to be transcribed from a named official publication with its retrieval date
 * recorded — "never hand-derived". Seeding plausible-looking figures from
 * memory would defeat the entire gate: the tables would look populated, payroll
 * would compute, and the numbers would be wrong in a way nobody notices until
 * KWSP or LHDN reconciles.
 *
 * So this creates the rate VERSION with its provenance fields and leaves
 * verifiedAt NULL. The compute endpoint refuses to run on an unverified
 * version (see resolveRateVersion in statutory.routes.js), which means
 * Malaysian payroll fails closed with an actionable 503 until someone loads
 * the real tables and records who checked them.
 *
 * To complete it:
 *   1. Transcribe the KWSP Third Schedule into EpfBand
 *      (wage band x age band x citizenship).
 *   2. Transcribe the PERKESO Second Schedule into SocsoBand (categories 1, 2).
 *   3. Transcribe the EIS contribution table into EisBand.
 *   4. Transcribe the LHDN MTD bands into PcbBand, per category, and the
 *      relief amounts into PcbRelief.
 *   5. Set HrdLevyRate from the PSMB Act headcount bands.
 *   6. Add a reconciliation test per §A7.2 asserting EVERY published row.
 *   7. Only then set verifiedBy/verifiedAt and isActive.
 */

const VERSION = 'MY-2026.1';

async function seed(prisma, { source, sourceUrl, retrievedAt } = {}) {
  if (!source || !retrievedAt) {
    throw new Error(
      'A Malaysian rate version requires `source` and `retrievedAt` (PRD §A7.1). ' +
      'Name the publication you transcribed from and when you retrieved it.');
  }

  return prisma.rateVersion.upsert({
    where: { version: VERSION },
    update: {},
    create: {
      country: 'MY',
      version: VERSION,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      source,
      sourceUrl: sourceUrl || null,
      retrievedAt: new Date(retrievedAt),
      // Left NULL on purpose. Setting these is the human act of confirming the
      // tables match the publication, and compute is blocked until then.
      verifiedBy: null,
      verifiedAt: null,
      isActive: false,
    },
  });
}

module.exports = { seed, VERSION };
