import { minutesToClock } from '@/lib/time';

export const SLOT_LABELS = ['Morning IN', 'Morning OUT', 'Afternoon IN', 'Afternoon OUT'];

/** 'HH:MM' values shown in the four inputs. Printed OUTs (12:00 / end of day) are included so they can be replaced. */
export function slotInputValues(row) {
  const minutes = row.printSlotMinutes ?? row.slotMinutes;
  return minutes.map((m) => (m == null || m >= 1440 ? '' : minutesToClock(m)));
}

/**
 * A real stored punch occupies the column. An automatic 12:00 or end-of-day
 * OUT does not, so changing it only adds the new time.
 */
function columnHasPunch(row, index) {
  const minutes = row.slotMinutes?.[index];
  return minutes != null && minutes < 1440 && Boolean(row.slotIds?.[index]);
}

/**
 * Compares the edited inputs with the row. A changed stored punch is voided
 * and the new time is added in that same column. A column with no stored
 * punch (including an automatic OUT) is only added. Times do not have to be
 * in order: any column can be set to any time.
 */
export function planDayChanges(row, values) {
  const shown = slotInputValues(row);
  const adds = [];
  const voids = [];
  values.forEach((value, i) => {
    if (value === shown[i]) return;
    if (columnHasPunch(row, i)) voids.push(row.slotIds[i]);
    if (value) adds.push({ date: row.date, time: `${value}:00`, slot: i });
  });
  return { adds, voids: [...new Set(voids)] };
}

/** Which halves have a stored or newly typed punch. Automatic 12:00 / end-of-day OUTs do not count. */
export function editedHalves(row, editedTimes) {
  const shown = slotInputValues(row);
  const present = (indexes) => indexes.some((i) => {
    if (editedTimes[i] !== shown[i]) return Boolean(editedTimes[i]);
    const minutes = row.slotMinutes?.[i];
    return minutes != null && minutes < 1440;
  });
  return { am: present([0, 1]), pm: present([2, 3]) };
}
