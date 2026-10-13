// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonthCalendar } from '@/features/schedules/MonthCalendar';

const holidays = [
  { id: 'h1', holiday_date: '2026-11-01', name: "All Saints' Day", holiday_type: 'special_non_working' },
  { id: 'h2', holiday_date: '2026-11-30', name: 'Bonifacio Day', holiday_type: 'regular' },
];
const leaves = [
  { id: 'l1', start_date: '2026-11-09', end_date: '2026-11-10', is_cancelled: false },
  { id: 'l2', start_date: '2026-11-10', end_date: '2026-11-10', is_cancelled: false },
  { id: 'l3', start_date: '2026-11-10', end_date: '2026-11-10', is_cancelled: true },
];

describe('MonthCalendar', () => {
  it('lays out the month from the correct weekday with holidays and leave counts', () => {
    render(<MonthCalendar year={2026} month={11} holidays={holidays} leaves={leaves} today="2026-11-10" />);
    // November 1, 2026 is a Sunday, so the first cell is day 1 (no leading blanks).
    const days = screen.getAllByText(/^\d{1,2}$/);
    expect(days[0]).toHaveTextContent('1');
    expect(days).toHaveLength(30);
    expect(screen.getByText("All Saints' Day")).toBeInTheDocument();
    expect(screen.getByText('Bonifacio Day')).toBeInTheDocument();
    expect(screen.getByText('2 on leave')).toBeInTheDocument();
    expect(screen.getByText('1 on leave')).toBeInTheDocument();
    expect(screen.getByText('10')).toHaveClass('bg-blue-600');
  });

  it('reports the clicked date and its holiday', async () => {
    const onDayClick = vi.fn();
    render(<MonthCalendar year={2026} month={11} holidays={holidays} leaves={[]} today="2026-10-13" onDayClick={onDayClick} />);
    await userEvent.click(screen.getByRole('button', { name: /^2026-11-30, Bonifacio Day/ }));
    expect(onDayClick).toHaveBeenCalledWith('2026-11-30', holidays[1]);
    await userEvent.click(screen.getByRole('button', { name: '2026-11-05' }));
    expect(onDayClick).toHaveBeenLastCalledWith('2026-11-05', null);
  });
});
