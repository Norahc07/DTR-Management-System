import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Download, Plus, Search, Upload, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Form';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Pagination, Table, Td, Th } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/features/auth/authContext';
import { downloadXlsx, fileStamp } from '@/lib/exporters';
import { EMPLOYMENT_STATUSES } from './employeeSchema';
import { listAllEmployees, listDepartments, listEmployees } from './employeeService';
import { EmployeeFormDialog } from './EmployeeFormDialog';
import { EmployeeImportDialog } from './EmployeeImportDialog';
import { DepartmentsDialog } from './DepartmentsDialog';

const STATUS_LABEL = Object.fromEntries(EMPLOYMENT_STATUSES);
const PAGE_SIZE = 25;

export function EmployeesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('employees.manage');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [active, setActive] = useState('active');
  const [sort, setSort] = useState({ key: 'last_name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const depts = useAsync(() => listDepartments({ includeInactive: true }), [], { cacheKey: 'departments-all' });
  const list = useAsync(() => listEmployees({ search, departmentId, active, sort, page, pageSize: PAGE_SIZE }), [search, departmentId, active, sort, page], { cacheKey: 'employees' });

  const onSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  const exportAll = async () => {
    setExporting(true);
    try {
      const rows = await listAllEmployees();
      downloadXlsx(
        [
          {
            name: 'Employees',
            rows: rows.map((e) => ({
              biometric_id: e.biometric_id,
              employee_no: e.employee_no ?? '',
              nickname: e.nickname ?? '',
              last_name: e.last_name,
              first_name: e.first_name ?? '',
              middle_name: e.middle_name ?? '',
              suffix: e.suffix ?? '',
              department: e.departments?.code ?? '',
              position: e.position ?? '',
              employment_status: e.employment_status,
              date_hired: e.date_hired ?? '',
              active: e.is_active ? 'yes' : 'no',
            })),
          },
        ],
        `employees-${fileStamp()}.xlsx`,
      );
    } catch (e) {
      toast.error(e.message);
    } finally {
      setExporting(false);
    }
  };

  const rows = list.data?.data ?? [];
  return (
    <>
      <PageHeader
        title="Employees"
        description="Employee records are matched to biometric punches by Biometric ID. Records with attendance history are deactivated, not deleted."
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Employees' }]}
        actions={
          <>
            <Button variant="secondary" icon={Download} onClick={exportAll} loading={exporting}>
              Export
            </Button>
            {manage && (
              <>
                <Button variant="secondary" icon={Building2} onClick={() => setDialog({ type: 'departments' })}>
                  Departments
                </Button>
                <Button variant="secondary" icon={Upload} onClick={() => setDialog({ type: 'import' })}>
                  Import
                </Button>
                <Button icon={Plus} onClick={() => setDialog({ type: 'form', employee: null })}>
                  Add employee
                </Button>
              </>
            )}
          </>
        }
      />
      <Card bodyClassName="">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" aria-hidden />
            <Input aria-label="Search employees" placeholder="Search by ID, name, position…" className="pl-9" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <Select aria-label="Department filter" className="w-48" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }}>
            <option value="">All departments</option>
            {(depts.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Status filter" className="w-36" value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
        </div>
        {list.error ? (
          <div className="p-4">
            <ErrorState error={list.error} onRetry={list.reload} />
          </div>
        ) : list.loading && !list.data ? (
          <div className="p-4">
            <Skeleton rows={8} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title={search || departmentId ? 'No employees match these filters' : 'No employees yet'}>
            {manage && !search && 'Add employees individually or import a spreadsheet. Biometric IDs must match the IDs enrolled on the device.'}
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th sortKey="biometric_id" sort={sort} onSort={onSort}>Biometric ID</Th>
                  <Th sortKey="last_name" sort={sort} onSort={onSort}>Name</Th>
                  <Th>Department</Th>
                  <Th sortKey="position" sort={sort} onSort={onSort}>Position</Th>
                  <Th sortKey="employment_status" sort={sort} onSort={onSort}>Employment</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <Td className="font-mono">{e.biometric_id}</Td>
                    <Td>
                      <Link to={`/employees/${e.id}`} className="font-medium text-blue-700 hover:underline">
                        {e.full_name}
                      </Link>
                      {e.nickname && <span className="ml-1.5 text-xs text-slate-500">({e.nickname})</span>}
                    </Td>
                    <Td>{e.departments?.name ?? <span className="text-slate-400">—</span>}</Td>
                    <Td>{e.position ?? <span className="text-slate-400">—</span>}</Td>
                    <Td>{STATUS_LABEL[e.employment_status]}</Td>
                    <Td>{e.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data?.count ?? 0} onPage={setPage} />
          </>
        )}
      </Card>

      <EmployeeFormDialog
        open={dialog?.type === 'form'}
        employee={dialog?.employee}
        departments={(depts.data ?? []).filter((d) => d.is_active)}
        onClose={() => setDialog(null)}
        onSaved={() => {
          toast.success('Employee saved');
          list.reload();
        }}
      />
      <EmployeeImportDialog
        open={dialog?.type === 'import'}
        onClose={() => setDialog(null)}
        departments={depts.data ?? []}
        onImported={(n) => {
          toast.success(`${n} employee(s) imported`);
          list.reload();
        }}
      />
      <DepartmentsDialog open={dialog?.type === 'departments'} onClose={() => { setDialog(null); depts.reload(); }} />
    </>
  );
}
