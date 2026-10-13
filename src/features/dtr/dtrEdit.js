import { minutesToClock, timeToMinutes } from '@/lib/time';

export const SLOT_LABELS = ['Morning IN', 'Morning OUT', 'Afternoon IN', 'Afternoon OUT'];

/** 'HH:MM' values for the four time inputs of a DTR row (next-day punches are not editable). */
export function slotInputValues(row) {
  return row.slotMinutes.map((m) => (m == null || m >= 1440 ? '' : minutesToClock(m)));
}

/** Filled times must be in order: morning IN < morning OUT < afternoon IN < afternoon OUT. */
export function orderProblem(values) {
  const filled = values.map((v, i) => [i, timeToMinutes(v)]).filter(([, m]) => m != null);
  for (let k = 1; k < filled.length; k++) {
    if (filled[k][1] <= filled[k - 1][1]) return `${SLOT_LABELS[filled[k][0]]} must be later than ${SLOT_LABELS[filled[k - 1][0]]}.`;
  }
  return null;
}

/**
 * Compares edited inputs with the DTR row and lists the punches to add and
 * the punch ids to void. A changed time is a void of the old punch plus a new one.
 */
export function planDayChanges(row, values) {
  const original = slotInputValues(row);
  const adds = [];
  const voids = [];
  values.forEach((value, i) => {
    if (row.slotMinutes[i] != null && row.slotMinutes[i] >= 1440) return;
    if (value === original[i]) return;
    if (original[i]) {
      if (!row.slotIds[i]) throw new Error(`${row.date}: the existing ${SLOT_LABELS[i]} cannot be changed here.`);
      voids.push(row.slotIds[i]);
    }
    if (value) adds.push({ date: row.date, time: `${value}:00` });
  });
  return { adds, voids };
}
