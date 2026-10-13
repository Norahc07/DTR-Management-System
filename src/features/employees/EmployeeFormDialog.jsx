import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Feedback';
import { DTR_FORMATS, EMPLOYMENT_STATUSES, employeeSchema } from './employeeSchema';
import { createEmployee, findNameDuplicates, updateEmployee } from './employeeService';

const toForm = (e) => ({
  biometric_id: e?.biometric_id ?? '',
  employee_no: e?.employee_no ?? '',
  nickname: e?.nickname ?? '',
  last_name: e?.last_name ?? '',
  first_name: e?.first_name ?? '',
  middle_name: e?.middle_name ?? '',
  suffix: e?.suffix ?? '',
  department_id: e?.department_id ?? '',
  position: e?.position ?? '',
  employment_status: e?.employment_status ?? 'regular',
  date_hired: e?.date_hired ?? '',
  dtr_format: e?.dtr_format ?? 'standard',
  verifier_name: e?.verifier_name ?? '',
  verifier_title: e?.verifier_title ?? '',
});

export function EmployeeFormDialog(props) {
  return props.open ? <EmployeeForm {...props} /> : null;
}

function EmployeeForm({ open, onClose, employee, departments, onSaved }) {
  const [error, setError] = useState(null);
  const [dupes, setDupes] = useState(null);
  const { register, handleSubmit, formState, getValues } = useForm({ resolver: zodResolver(employeeSchema), defaultValues: toForm(employee) });

  const save = async (values, confirmedDuplicate = false) => {
    setError(null);
    try {
      if (!confirmedDuplicate) {
        const found = await findNameDuplicates(values, employee?.id);
        if (found.length) {
          setDupes(found);
          return;
        }
      }
      const saved = employee ? await updateEmployee(employee.id, values) : await createEmployee(values);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(/biometric_id/.test(e.cause?.message || '') || e.cause?.code === '23505' ? 'That biometric ID or employee number is already assigned to another employee.' : e.message);
    }
  };

  const err = formState.errors;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={employee ? `Edit ${employee.full_name}` : 'Add employee'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {dupes ? (
            <Button variant="primary" loading={formState.isSubmitting} onClick={() => save(employeeSchema.parse(getValues()), true)}>
              Save anyway
            </Button>
          ) : (
            <Button type="submit" form="employee-form" loading={formState.isSubmitting}>
              Save
            </Button>
          )}
        </>
      }
    >
      <form id="employee-form" noValidate onSubmit={handleSubmit((v) => save(v))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
        {dupes && (
          <Alert tone="warning" title="Possible duplicate employee" className="sm:col-span-2">
            <ul className="list-disc pl-5">
              {dupes.map((d) => (
                <li key={d.id}>
                  {d.full_name} (biometric ID {d.biometric_id}){d.is_active ? '' : ' — inactive'}
                </li>
              ))}
            </ul>
            <p className="mt-1">Confirm this is a different person before saving.</p>
          </Alert>
        )}
        <Field label="Biometric ID" required error={err.biometric_id?.message} hint="The user ID enrolled on the biometric device. Stored as text so leading zeros are preserved.">
          {(p) => <Input {...p} {...register('biometric_id')} autoComplete="off" placeholder="e.g. 12" />}
        </Field>
        <Field label="Employee number" error={err.employee_no?.message}>
          {(p) => <Input {...p} {...register('employee_no')} placeholder="e.g. EMP-0012" />}
        </Field>
        <Field label="Nickname (device name)" error={err.nickname?.message} hint="The short name on the biometric device, e.g. “jm”.">
          {(p) => <Input {...p} {...register('nickname')} autoComplete="off" placeholder="e.g. jm" />}
        </Field>
        <Field label="Last name" required error={err.last_name?.message} hint="Printed on the DTR as LAST NAME, First name. If only the device name is known, enter it here and leave First name blank.">
          {(p) => <Input {...p} {...register('last_name')} placeholder="e.g. DELA CRUZ" />}
        </Field>
        <Field label="First name" error={err.first_name?.message}>
          {(p) => <Input {...p} {...register('first_name')} placeholder="e.g. JUAN" />}
        </Field>
        <Field label="Middle name" error={err.middle_name?.message}>
          {(p) => <Input {...p} {...register('middle_name')} placeholder="e.g. SANTOS" />}
        </Field>
        <Field label="Suffix" error={err.suffix?.message}>
          {(p) => <Input {...p} {...register('suffix')} placeholder="Jr., III" />}
        </Field>
        <Field label="Department" error={err.department_id?.message}>
          {(p) => (
            <Select {...p} {...register('department_id')}>
              <option value="">— None —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Position" error={err.position?.message}>
          {(p) => <Input {...p} {...register('position')} placeholder="e.g. Administrative Aide" />}
        </Field>
        <Field label="Employment status" error={err.employment_status?.message}>
          {(p) => (
            <Select {...p} {...register('employment_status')}>
              {EMPLOYMENT_STATUSES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Date hired" error={err.date_hired?.message}>
          {(p) => <Input {...p} type="date" {...register('date_hired')} />}
        </Field>
        <Field label="DTR format">
          {(p) => (
            <Select {...p} {...register('dtr_format')}>
              {DTR_FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          )}
        </Field>
        <Field label="DTR verifier name" error={err.verifier_name?.message} hint="Printed under “VERIFIED as to the prescribed office hours”. Leave blank for the usual verifier.">
          {(p) => <Input {...p} {...register('verifier_name')} placeholder="e.g. MIRABUENO, CONCHITA MARTA B." />}
        </Field>
        <Field label="DTR verifier title" error={err.verifier_title?.message}>
          {(p) => <Input {...p} {...register('verifier_title')} placeholder="Municipal Mayor" />}
        </Field>
      </form>
    </Dialog>
  );
}
