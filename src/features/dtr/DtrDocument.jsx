import { formatDateKey, instantToDateKey } from '@/lib/time';
import { buildForm48, dtrHeader, hoursAndMinutes } from './form48';

/**
 * One Civil Service Form No. 48 (half of an A4 portrait sheet). A small
 * "Draft" note is printed until a finalization record exists.
 */
export function DtrDocument({ org, employee, year, month, period, dtr, template, finalization, header: override = null }) {
  const t = template;
  const { rows, totalUndertime } = buildForm48({ dtr, year, month, period, showUndertime: t.showComputation, format: employee.dtr_format });
  const header = dtrHeader({ year, month, period, official: dtr.official, template: t, override });
  const total = hoursAndMinutes(totalUndertime);
  const name = (employee.full_name || '').toUpperCase();
  return (
    <article className="cs48" aria-label={`Daily time record of ${employee.full_name}`}>
      <p className="cs48-form-no">{t.formNumber}</p>
      <h2 className="cs48-title">{t.title.toUpperCase()}</h2>
      <p className="cs48-center">-----o0o-----</p>
      <p className="cs48-name">{name}</p>
      <p className="cs48-center">(Name)</p>

      <div className="cs48-meta">
        <span />
        <span className="cs48-meta-label">For the month of</span>
        <span className="cs48-meta-value cs48-italic">{header.month_label}</span>
        <span className="cs48-official">Official hours for<br />arrival and departure</span>
        <span className="cs48-meta-label">{header.regular_days}</span>
        <span className="cs48-meta-value">{header.regular_hours}</span>
        <span className="cs48-meta-label">{header.rest_days}</span>
        <span className="cs48-meta-value">{header.rest_hours}</span>
      </div>

      <table className="cs48-table">
        <colgroup>
          <col style={{ width: '13%' }} />
          {[0, 1, 2, 3, 4, 5].map((i) => <col key={i} style={{ width: '14.5%' }} />)}
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2} className="cs48-plain">Day</th>
            <th colSpan={2}>A.M.</th>
            <th colSpan={2}>P.M.</th>
            <th colSpan={2}>Undertime</th>
          </tr>
          <tr className="cs48-plain">
            <th>Arrival</th>
            <th>Depar-<br />ture</th>
            <th>Arrival</th>
            <th>Depar-<br />ture</th>
            <th>Hours</th>
            <th>Min</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ut = r.kind === 'times' ? hoursAndMinutes(r.undertime) : { hours: '', min: '' };
            return (
              <tr key={r.day}>
                <td className="cs48-day">{r.day}</td>
                {r.kind === 'label' ? (
                  <td colSpan={4} className={`cs48-label${r.alert ? ' cs48-alert' : ''}`}>{r.text}</td>
                ) : r.halfDay === 'am' ? (
                  <>
                    <td colSpan={2} className="cs48-label">{r.halfDayText}</td>
                    <td>{r.slots[2]}</td>
                    <td>{r.slots[3]}</td>
                  </>
                ) : r.halfDay === 'pm' ? (
                  <>
                    <td>{r.slots[0]}</td>
                    <td>{r.slots[1]}</td>
                    <td colSpan={2} className="cs48-label">{r.halfDayText}</td>
                  </>
                ) : (
                  [0, 1, 2, 3].map((i) => <td key={i}>{r.kind === 'times' ? r.slots[i] : ''}</td>)
                )}
                {r.remark ? (
                  <td colSpan={2} className="cs48-label">{r.remark}</td>
                ) : (
                  <>
                    <td>{ut.hours}</td>
                    <td>{ut.min}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className="cs48-total">Total</td>
            <td>{total.hours}</td>
            <td>{total.min}</td>
          </tr>
          <tr className="cs48-after-total">
            <td colSpan={5} />
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>

      <p className="cs48-cert">{t.certificationText}</p>
      <p className="cs48-sign">{name}</p>
      <p className="cs48-center cs48-italic">{t.verifiedText}</p>
      <p className="cs48-sign">{(employee.verifier_name || t.verifierName).toUpperCase()}</p>
      <p className="cs48-center cs48-sign-title">{employee.verifier_name ? employee.verifier_title || '' : t.verifierTitle}</p>
      <p className="cs48-status">
        {finalization
          ? `Finalized ${formatDateKey(instantToDateKey(finalization.finalized_at, org?.timezone || 'Asia/Manila'), org?.date_format)}`
          : 'Draft — not finalized'}
      </p>
    </article>
  );
}

/** One A4 portrait sheet holding two forms side by side. */
export function DtrSheet({ children }) {
  return (
    <section className="dtr-sheet print-page" style={{ width: '210mm', height: '297mm' }}>
      {children}
    </section>
  );
}
