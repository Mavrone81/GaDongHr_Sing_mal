'use strict';

/** Haversine distance between two GPS coordinates, in metres. */
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Determine if a clock-in at the given UTC Date is late for Singapore time.
 * Late = after 09:15 SGT.
 */
function isLate(nowUtc) {
  const sgHour = parseInt(
    new Intl.DateTimeFormat('en-SG', { hour: 'numeric', hour12: false, timeZone: 'Asia/Singapore' }).format(nowUtc)
  );
  const sgMin = parseInt(
    new Intl.DateTimeFormat('en-SG', { minute: 'numeric', timeZone: 'Asia/Singapore' }).format(nowUtc)
  );
  return sgHour > 9 || (sgHour === 9 && sgMin >= 15);
}

/** Hours worked between two Date objects, rounded to 2dp. */
function calcHoursWorked(clockInDate, clockOutDate) {
  return Math.round((clockOutDate - clockInDate) / (1000 * 60 * 60) * 100) / 100;
}

/** OT hours beyond 8h working day, floored at 0 and rounded to 2dp. */
function calcOtHours(hoursWorked) {
  return Math.round(Math.max(0, hoursWorked - 8) * 100) / 100;
}

module.exports = { haversineMetres, isLate, calcHoursWorked, calcOtHours };
