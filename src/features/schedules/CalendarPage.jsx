import { useState } from 'react';
import { Cake, CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Form';
import { Table, Td, Th } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/features/auth/authContext';
import { MONTH_NAMES, WEEKDAY_SHORT, parseDateKey, todayInZone, weekdayOf } from '@/lib/time';
import { deleteHoliday, listHolidays, listLeaves, listStaffBirthdays, saveHoliday, setBirthday } from './scheduleService';
import { HOLIDAY_STYLES, HOLIDAY_TYPES } from './holidayTypes';
import { withPhilippineHolidays } from './phHolidays';
import { ageOn, birthdaysInMonth } from './birthdays';
import { MonthCalendar } from './MonthCalendar';

function HolidayDialog({ open, holiday, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm({ id: holiday?.auto ? undefined : holiday?.id, holiday_date: holiday?.holiday_date ?? '', name: holiday?.name ?? '', holiday_type: holiday?.holiday_type ?? 'regular' });
      setError(null);
    }
  }
  const save = async () => {
    if (!form.holiday_date || !form.name?.trim()) return setError('Date and name are required.');
    setBusy(true);
    setError(null);
    try {
      await saveHoliday({ ...form, name: form.name.trim() });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const title = holiday?.auto ? 'Change standard holiday' : holiday?.id ? 'Edit holiday' : 'Add holiday';
  return (
    <Dialog open={open} onClose={onClose} size="sm" title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-3">
        {holiday?.auto && (
          <Alert tone="info">
            This is a standard Philippine holiday shown automatically. Saving records your version for this date (for example a renamed day, a different type, or “Special working day” if it was moved or is not observed).
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Date" required>{(p) => <Input {...p} type="date" value={form.holiday_date ?? ''} onChange={(e) => setForm({ ...form, holiday_date: e.target.value })} />}</Field>
        <Field label="Name" required>{(p) => <Input {...p} value={form.name ?? ''} maxLength={150} placeholder="e.g. Independence Day" onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label="Type" hint="Verify each date against the official proclamation for the year.">
          {(p) => (
            <Select {...p} value={form.holiday_type ?? 'regular'} onChange={(e) => setForm({ ...form, holiday_type: e.target.value })}>
              {Object.entries(HOLIDAY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function BirthdayDialog({ open, employee, staff, today, onClose, onSaved }) {
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setEmployeeId(employee?.id ?? '');
      setDate(employee?.birth_date ?? '');
      setError(null);
    }
  }
  const choices = staff.filter((s) => !s.birth_date);
  const save = async () => {
    if (!employeeId || !date) return setError('Choose the staff member and the birth date.');
    if (date > today) return setError('The birth date cannot be in the future.');
    setBusy(true);
    setError(null);
    try {
      await setBirthday(employeeId, date);
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} size="sm" title={employee ? `Edit birthday — ${employee.full_name}` : 'Add birthday'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        {!employee && (
          <Field label="Staff" required hint="Only active staff without a birthday yet are listed.">
            {(p) => (
              <Select {...p} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">{choices.length ? 'Select staff' : 'All active staff already have a birthday'}</option>
                {choices.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.nickname ? ` (${s.nickname})` : ''}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Birth date" required>{(p) => <Input {...p} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

const birthdayLabel = (birthDate) => `${MONTH_NAMES[Number(birthDate.slice(5, 7)) - 1]} ${Number(birthDate.slice(8, 10))}`;

export function CalendarPage() {
  const { can, timezone } = useAuth();
  const toast = useToast();
  const manage = can('schedules.manage');
  const editStaff = can('employees.manage');
  const today = todayInZone(timezone);
  const [view, setView] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const { year, month } = view;
  const holidays = useAsync(() => listHolidays(year), [year], { cacheKey: 'holidays' });
  const leaves = useAsync(() => listLeaves({ from: `${year}-01-01`, to: `${year}-12-31` }), [year], { cacheKey: 'leaves' });
  const staff = useAsync(() => listStaffBirthdays(), [], { cacheKey: 'birthdays' });
  const [holidayDialog, setHolidayDialog] = useState(null);
  const [birthdayDialog, setBirthdayDialog] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const shift = (delta) =>
    setView(({ year: y, month: m }) => {
      const idx = y * 12 + (m - 1) + delta;
      const ny = Math.floor(idx / 12);
      return ny < 2000 || ny > 2100 ? { year: y, month: m } : { year: ny, month: (idx % 12) + 1 };
    });
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const allHolidays = holidays.data ? withPhilippineHolidays(holidays.data, `${year}-01-01`, `${year}-12-31`) : [];
  const monthHolidays = allHolidays.filter((h) => h.holiday_date.startsWith(monthKey));
  const autoCount = allHolidays.filter((h) => h.auto).length;
  const staffList = staff.data ?? [];
  const monthBirthdays = birthdaysInMonth(staffList, year, month);
  const withBirthday = staffList
    .filter((s) => s.birth_date)
    .sort((a, b) => a.birth_date.slice(5).localeCompare(b.birth_date.slice(5)) || a.full_name.localeCompare(b.full_name));
  const missingBirthday = staffList.length - withBirthday.length;
  const openDay = manage ? (date, holiday) => setHolidayDialog({ holiday: holiday ?? { holiday_date: date } }) : undefined;

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Philippine holidays are shown automatically and count in attendance. Recompute attendance for affected dates after changes; finalized DTR periods are not changed."
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Calendar' }]}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card
          title={
            <span className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-slate-500" aria-hidden />
              <span aria-live="polite">{MONTH_NAMES[month - 1]} {year}</span>
            </span>
          }
          actions={
            <>
              <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label="Previous month" onClick={() => shift(-1)} />
              <Button size="sm" variant="secondary" onClick={() => setView({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) })}>Today</Button>
              <Button size="sm" variant="ghost" icon={ChevronRight} aria-label="Next month" onClick={() => shift(1)} />
            </>
          }
          bodyClassName=""
        >
          {holidays.error ? (
            <div className="p-4"><ErrorState error={holidays.error} onRetry={holidays.reload} /></div>
          ) : (
            <>
              <MonthCalendar year={year} month={month} holidays={allHolidays} leaves={leaves.data ?? []} birthdays={monthBirthdays} today={today} onDayClick={openDay} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
                {Object.entries(HOLIDAY_TYPES).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${HOLIDAY_STYLES[k].dot}`} aria-hidden />{v}</span>
                ))}
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-pink-400" aria-hidden />Birthday</span>
                {manage && <span className="ml-auto text-slate-500">Click a day to add or change its holiday.</span>}
              </div>
            </>
          )}
        </Card>

        <Card
          title={`Holidays in ${MONTH_NAMES[month - 1]}`}
          actions={manage && <Button size="sm" icon={Plus} onClick={() => setHolidayDialog({ holiday: null })}>Add</Button>}
          bodyClassName=""
        >
          {holidays.loading && !holidays.data ? (
            <div className="p-4"><Skeleton rows={4} /></div>
          ) : holidays.error ? null : !monthHolidays.length ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              <CalendarDays className="mx-auto mb-2 h-6 w-6 text-slate-300" aria-hidden />
              No holidays in {MONTH_NAMES[month - 1]} {year}.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {monthHolidays.map((h) => {
                const d = parseDateKey(h.holiday_date);
                return (
                  <li key={h.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="w-11 shrink-0 rounded-md border border-slate-200 text-center">
                      <div className={`rounded-t-md text-[10px] font-semibold text-white uppercase ${HOLIDAY_STYLES[h.holiday_type]?.dot}`}>{WEEKDAY_SHORT[weekdayOf(h.holiday_date)]}</div>
                      <div className="py-0.5 text-lg leading-tight font-semibold text-slate-800">{d.day}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">{h.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={HOLIDAY_STYLES[h.holiday_type]?.tone}>{HOLIDAY_TYPES[h.holiday_type]}</Badge>
                        {h.auto && <Badge>Automatic</Badge>}
                      </div>
                    </div>
                    {manage && (
                      <div className="flex shrink-0">
                        <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${h.name}`} onClick={() => setHolidayDialog({ holiday: h })} />
                        {!h.auto && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${h.name}`} onClick={() => setConfirm({ type: 'holiday', item: h })} />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
            {allHolidays.length} holidays in {year}: {autoCount} standard Philippine holidays shown automatically and {allHolidays.length - autoCount} recorded. Eid’l Fitr, Eid’l Adha and other days proclaimed each year must be added when announced.
          </p>
        </Card>
      </div>

      <Card
        title={
          <span className="flex items-center gap-2">
            <Cake className="h-4 w-4 text-pink-500" aria-hidden />
            Staff birthdays
          </span>
        }
        className="mt-4"
        actions={editStaff && staff.data && missingBirthday > 0 && <Button size="sm" icon={Plus} onClick={() => setBirthdayDialog({ employee: null })}>Add birthday</Button>}
        bodyClassName=""
      >
        {staff.error ? (
          <div className="p-4"><ErrorState error={staff.error} onRetry={staff.reload} /></div>
        ) : staff.loading && !staff.data ? (
          <div className="p-4"><Skeleton /></div>
        ) : !withBirthday.length ? (
          <EmptyState icon={Cake} title="No birthdays added yet">{editStaff && 'Use “Add birthday” to add each staff member’s birth date.'}</EmptyState>
        ) : (
          <>
            <Table>
              <thead><tr><Th>Name</Th><Th>Birthday</Th><Th>Turns (in {year})</Th>{editStaff && <Th />}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {withBirthday.map((s) => {
                  const thisMonth = Number(s.birth_date.slice(5, 7)) === month;
                  return (
                    <tr key={s.id} className={thisMonth ? 'bg-pink-50/60' : ''}>
                      <Td>
                        {s.full_name} {s.nickname && <span className="text-xs text-slate-500">({s.nickname})</span>}
                        {thisMonth && <span className="ml-2"><Badge tone="purple">This month</Badge></span>}
                      </Td>
                      <Td>{birthdayLabel(s.birth_date)}</Td>
                      <Td>{ageOn(s.birth_date, year)}</Td>
                      {editStaff && (
                        <Td className="text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${s.full_name}'s birthday`} onClick={() => setBirthdayDialog({ employee: s })} />
                          <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${s.full_name}'s birthday`} onClick={() => setConfirm({ type: 'birthday', item: s })} />
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {missingBirthday > 0 && <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">{missingBirthday} active staff without a birthday yet.</p>}
          </>
        )}
      </Card>

      <HolidayDialog open={Boolean(holidayDialog)} holiday={holidayDialog?.holiday} onClose={() => setHolidayDialog(null)} onSaved={() => { toast.success('Holiday saved'); holidays.reload(); }} />
      <BirthdayDialog open={Boolean(birthdayDialog)} employee={birthdayDialog?.employee} staff={staffList} today={today} onClose={() => setBirthdayDialog(null)} onSaved={() => { toast.success('Birthday saved'); staff.reload(); }} />
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        tone="danger"
        title={confirm?.type === 'holiday' ? 'Delete holiday' : 'Remove birthday'}
        confirmLabel={confirm?.type === 'holiday' ? 'Delete' : 'Remove'}
        onConfirm={async () => {
          if (confirm.type === 'holiday') {
            await deleteHoliday(confirm.item.id);
            holidays.reload();
          } else {
            await setBirthday(confirm.item.id, null);
            staff.reload();
          }
          toast.success('Saved');
        }}
      >
        <p>
          {confirm?.type === 'holiday'
            ? `Remove “${confirm.item.name}” (${confirm.item.holiday_date})? If it is a standard Philippine holiday date, the standard holiday shows again. Recompute attendance for that date afterwards.`
            : `Remove ${confirm?.item.full_name}'s birthday? They will appear again in the “Add birthday” list.`}
        </p>
      </ConfirmDialog>
    </>
  );
}
