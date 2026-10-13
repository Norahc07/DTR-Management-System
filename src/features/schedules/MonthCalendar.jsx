import { Cake } from 'lucide-react';
import { WEEKDAY_SHORT, daysInMonth, toDateKey, weekdayOf } from '@/lib/time';
import { HOLIDAY_STYLES, HOLIDAY_TYPES } from './holidayTypes';

/**
 * Month grid (Sunday first). Holidays appear as colored chips; active leave
 * records show as a count. Clicking a day calls onDayClick when provided.
 */
export function MonthCalendar({ year, month, holidays = [], leaves = [], birthdays = [], today, onDayClick }) {
  const first = toDateKey(year, month, 1);
  const lead = weekdayOf(first);
  const total = daysInMonth(year, month);
  const cells = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const holidaysByDate = new Map();
  for (const h of holidays) holidaysByDate.set(h.holiday_date, [...(holidaysByDate.get(h.holiday_date) || []), h]);
  const leaveCount = (key) => leaves.filter((l) => !l.is_cancelled && l.start_date <= key && l.end_date >= key).length;

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {WEEKDAY_SHORT.map((d, i) => (
          <div key={d} className={`py-2 ${i === 0 || i === 6 ? 'text-slate-400' : ''}`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (!day) return <div key={`b${i}`} className="min-h-24 border-r border-b border-slate-100 bg-slate-50/60 [&:nth-child(7n)]:border-r-0" aria-hidden />;
          const key = toDateKey(year, month, day);
          const dayHolidays = holidaysByDate.get(key) || [];
          const onLeave = leaveCount(key);
          const dayBirthdays = birthdays.filter((b) => b.day === day);
          const weekend = i % 7 === 0 || i % 7 === 6;
          const isToday = key === today;
          const label = [
            key,
            ...dayHolidays.map((h) => `${h.name} (${HOLIDAY_TYPES[h.holiday_type]})`),
            ...dayBirthdays.map((b) => `${b.full_name}'s birthday`),
            onLeave ? `${onLeave} on leave` : '',
          ].filter(Boolean).join(', ');
          const Cell = onDayClick ? 'button' : 'div';
          return (
            <Cell
              key={key}
              type={onDayClick ? 'button' : undefined}
              aria-label={onDayClick ? label : undefined}
              title={onDayClick ? undefined : label}
              onClick={onDayClick ? () => onDayClick(key, dayHolidays[0] || null) : undefined}
              className={`flex min-h-24 flex-col items-stretch gap-1 border-r border-b border-slate-100 p-1.5 text-left [&:nth-child(7n)]:border-r-0 ${weekend ? 'bg-slate-50/70' : 'bg-white'} ${onDayClick ? 'hover:bg-blue-50/60 focus-visible:relative focus-visible:z-10' : ''}`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-xs font-semibold ${
                  isToday ? 'bg-blue-600 text-white' : dayHolidays.some((h) => h.holiday_type !== 'special_working') ? 'text-red-700' : weekend ? 'text-slate-400' : 'text-slate-700'
                }`}
              >
                {day}
              </span>
              {dayHolidays.map((h) => (
                <span key={h.id} title={`${h.name} — ${HOLIDAY_TYPES[h.holiday_type]}`} className={`truncate rounded px-1.5 py-0.5 text-[11px] leading-tight font-medium ring-1 ring-inset ${HOLIDAY_STYLES[h.holiday_type]?.chip}`}>
                  {h.name}
                </span>
              ))}
              {dayBirthdays.map((b) => (
                <span key={`b-${b.id}`} title={`${b.full_name}'s birthday`} className="flex items-center gap-1 truncate rounded bg-pink-50 px-1.5 py-0.5 text-[11px] leading-tight font-medium text-pink-800 ring-1 ring-pink-200 ring-inset">
                  <Cake className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{b.nickname || b.full_name}</span>
                </span>
              ))}
              {onLeave > 0 && <span className="mt-auto truncate text-[11px] text-blue-700">{onLeave} on leave</span>}
            </Cell>
          );
        })}
      </div>
    </div>
  );
}
