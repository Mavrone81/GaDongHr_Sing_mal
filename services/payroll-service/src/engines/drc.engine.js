'use strict';

/**
 * DRC (Dependency Ratio Ceiling) engine — pure, no DB.
 *
 * MOM rules (as of 2024-01-01):
 *   The DRC ratio = FW headcount / (local + FW headcount) × 100%
 *   "Local" = SC + PR (any year). EP holders are exempt from DRC counts.
 *   WP and S-Pass are the only pass types that count toward DRC.
 *
 * Default MOM ceilings (% of total workforce):
 *   Services:       WP 15%,  S-Pass 15%
 *   Construction:   WP 83%,  S-Pass 18%
 *   Marine:         WP 83%,  S-Pass 18%
 *   Process:        WP 83%,  S-Pass 18%
 *   Manufacturing:  WP 60%,  S-Pass 15%
 */

const PASS_TYPES_IN_DRC = new Set(['WP', 'S_PASS']);
const LOCAL_CITIZEN_STATUSES = new Set(['SC', 'PR_YEAR1', 'PR_YEAR2', 'PR_YR3_PLUS']);

// Default MOM ceilings when no DB quota is configured
const MOM_DEFAULTS = [
  { sector: 'SERVICES',      passType: 'WP',     maxRatioPct: 15.0, alertThreshPct: 80.0 },
  { sector: 'SERVICES',      passType: 'S_PASS',  maxRatioPct: 15.0, alertThreshPct: 80.0 },
  { sector: 'CONSTRUCTION',  passType: 'WP',     maxRatioPct: 83.0, alertThreshPct: 80.0 },
  { sector: 'CONSTRUCTION',  passType: 'S_PASS',  maxRatioPct: 18.0, alertThreshPct: 80.0 },
  { sector: 'MARINE',        passType: 'WP',     maxRatioPct: 83.0, alertThreshPct: 80.0 },
  { sector: 'MARINE',        passType: 'S_PASS',  maxRatioPct: 18.0, alertThreshPct: 80.0 },
  { sector: 'PROCESS',       passType: 'WP',     maxRatioPct: 83.0, alertThreshPct: 80.0 },
  { sector: 'PROCESS',       passType: 'S_PASS',  maxRatioPct: 18.0, alertThreshPct: 80.0 },
  { sector: 'MANUFACTURING', passType: 'WP',     maxRatioPct: 60.0, alertThreshPct: 80.0 },
  { sector: 'MANUFACTURING', passType: 'S_PASS',  maxRatioPct: 15.0, alertThreshPct: 80.0 },
];

/**
 * Classify each employee into local / WP / S_PASS / exempt buckets per sector.
 *
 * @param {Array<{ passType?: string, workPassSector?: string, citizenshipStatus?: string }>} employees
 * @returns {Map<string, { localCount: number, wp: number, sPass: number }>}  keyed by sector (uppercase)
 */
function groupBySector(employees) {
  // Sector map: sector → { localCount, wp, sPass }
  const sectors = new Map();
  const ensure = s => {
    if (!sectors.has(s)) sectors.set(s, { localCount: 0, wp: 0, sPass: 0 });
    return sectors.get(s);
  };

  for (const emp of employees) {
    const pass = (emp.passType || '').toUpperCase();
    const cs   = (emp.citizenshipStatus || emp.citizenStatus || '').toUpperCase();
    const sector = (emp.workPassSector || '').toUpperCase();

    if (PASS_TYPES_IN_DRC.has(pass)) {
      // FW counted for DRC — must have a sector
      const s = sector || 'SERVICES'; // default to SERVICES if not set
      const g = ensure(s);
      if (pass === 'WP')     g.wp     += 1;
      if (pass === 'S_PASS') g.sPass  += 1;
    } else if (LOCAL_CITIZEN_STATUSES.has(cs) || !pass) {
      // Local worker — no sector needed; add to ALL sectors they could contribute to
      // In practice a company may operate in one sector; add local headcount to 'LOCAL'
      // We aggregate locals globally and distribute when computing ratios.
      // For simplicity: locals are counted in a special 'LOCAL' key; ratio function merges.
      const g = ensure('LOCAL');
      g.localCount += 1;
    }
    // EP, DP, LTVP, SP (Employment Pass, Dependant, etc.) — exempt from DRC, not counted
  }

  return sectors;
}

/**
 * Compute DRC status for all sector × passType combinations.
 *
 * @param {Map<string, { localCount: number, wp: number, sPass: number }>} sectorGroups  from groupBySector()
 * @param {Array<{ sector: string, passType: string, maxRatioPct: number, alertThreshPct: number }>} quotas
 * @returns {Array<DrcResult>}
 */
function computeDrcStatus(sectorGroups, quotas) {
  const localCount = sectorGroups.get('LOCAL')?.localCount || 0;
  const results = [];

  // Build a lookup map from configured quotas
  const quotaMap = new Map(quotas.map(q => [`${q.sector}__${q.passType}`, q]));

  // All sectors to evaluate = union of sectors with FW employees + sectors in quotas
  const allSectors = new Set([
    ...quotas.map(q => q.sector),
    ...[...sectorGroups.keys()].filter(s => s !== 'LOCAL'),
  ]);

  for (const sector of allSectors) {
    const group = sectorGroups.get(sector) || { wp: 0, sPass: 0, localCount: 0 };

    for (const passType of ['WP', 'S_PASS']) {
      const fwCount = passType === 'WP' ? group.wp : group.sPass;
      const totalHeadcount = localCount + group.wp + group.sPass;

      // Ceiling from DB quota or MOM default
      const configKey = `${sector}__${passType}`;
      const quota = quotaMap.get(configKey) || MOM_DEFAULTS.find(d => d.sector === sector && d.passType === passType);
      if (!quota) continue;

      const currentRatioPct = totalHeadcount > 0
        ? Math.round((fwCount / totalHeadcount) * 10000) / 100  // 2 decimal places
        : 0;

      const usagePct = quota.maxRatioPct > 0
        ? Math.round((currentRatioPct / quota.maxRatioPct) * 10000) / 100
        : 0;

      let status;
      if (currentRatioPct > quota.maxRatioPct) {
        status = 'EXCEEDED';
      } else if (usagePct >= (quota.alertThreshPct ?? 80)) {
        status = 'WARNING';
      } else {
        status = 'OK';
      }

      results.push({
        sector,
        passType,
        localCount,
        fwCount,
        totalHeadcount,
        currentRatioPct,
        maxRatioPct: quota.maxRatioPct,
        alertThreshPct: quota.alertThreshPct ?? 80,
        usagePct,
        status,
        remainingHeadroom: Math.max(
          0,
          Math.floor(((quota.maxRatioPct / 100) * totalHeadcount - fwCount) * 10) / 10
        ),
      });
    }
  }

  // Sort: EXCEEDED first, then WARNING, then OK; within same status by sector+passType
  const ORDER = { EXCEEDED: 0, WARNING: 1, OK: 2 };
  results.sort((a, b) => {
    const d = ORDER[a.status] - ORDER[b.status];
    if (d !== 0) return d;
    return `${a.sector}__${a.passType}`.localeCompare(`${b.sector}__${b.passType}`);
  });

  return results;
}

module.exports = { groupBySector, computeDrcStatus, MOM_DEFAULTS, PASS_TYPES_IN_DRC, LOCAL_CITIZEN_STATUSES };
