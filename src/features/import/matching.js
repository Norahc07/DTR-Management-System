// Employee matching: biometric ID is authoritative. Names are only used to
// warn about conflicts or to *suggest* (never auto-apply) a link.

export function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** True when a workbook name plausibly refers to the employee (shares a nickname, last name or first name token). */
export function namesCompatible(workbookName, employee) {
  const tokens = new Set(normalizeName(workbookName));
  if (!tokens.size) return true;
  return [employee.nickname, employee.last_name, employee.first_name].some((n) => normalizeName(n).some((t) => tokens.has(t)));
}

/**
 * @param {Array<{biometricId:string,name:string}>} people distinct workbook people
 * @param {Array} employees rows from the employees table
 */
export function matchEmployees(people, employees) {
  const byBio = new Map(employees.map((e) => [e.biometric_id, e]));
  const results = new Map();
  for (const p of people) {
    const emp = byBio.get(p.biometricId) || null;
    const entry = { biometricId: p.biometricId, workbookNames: [...p.names], employee: emp, issues: [], suggestions: [] };
    if (emp) {
      if (!emp.is_active) entry.issues.push({ severity: 'warning', code: 'INACTIVE_EMPLOYEE', message: `Employee ${emp.full_name} is deactivated` });
      for (const n of p.names) {
        if (n && !namesCompatible(n, emp)) {
          entry.issues.push({ severity: 'warning', code: 'NAME_CONFLICT', message: `Workbook name "${n}" does not match employee "${emp.full_name}"` });
        }
      }
    } else {
      entry.issues.push({ severity: 'warning', code: 'UNMATCHED_ID', message: `No employee has biometric ID ${p.biometricId}` });
      for (const n of p.names) {
        for (const e of employees) {
          if (n && namesCompatible(n, e) && normalizeName(n).length > 0) entry.suggestions.push(e);
        }
      }
      entry.suggestions = [...new Map(entry.suggestions.map((e) => [e.id, e])).values()].slice(0, 3);
    }
    if (p.names.size > 1) {
      entry.issues.push({ severity: 'warning', code: 'ID_MULTIPLE_NAMES', message: `ID ${p.biometricId} appears with different names: ${[...p.names].join(', ')}` });
    }
    results.set(p.biometricId, entry);
  }
  return results;
}
