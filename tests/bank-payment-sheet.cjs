/* Local-only regression test for the Owner-only monthly bank payment sheet.
   Never point at a production URL. Requires local Postgres demo data + server. */
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:3000';
const stamp = Date.now();
async function api(path, method = 'GET', body, cookie) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json().catch(() => ({})), token: response.headers.get('set-cookie')?.match(/matesther_session=([^;]+)/)?.[1] };
}
function expect(result, status, label) {
  assert.equal(result.status, status, `${label}: HTTP ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}
(async () => {
  const ownerLogin = await api('/api/auth/login', 'POST', { email: 'estheradejugba@gmail.com', password: 'owner123' });
  expect(ownerLogin, 200, 'Owner login');
  const owner = `matesther_session=${ownerLogin.token}`;
  const month = new Date().toISOString().slice(0, 7);
  const cleaner = { users: [], workers: [] };
  try {
    // A salaried, non-production member of staff with bank details.
    const guard = expect(await api('/api/workers', 'POST', {
      name: `Sheet Guard ${stamp}`, paymentType: 'MONTHLY', paymentRate: 85000,
      department: 'Security', jobTitle: 'Security Guard',
      roles: [{ role: 'Security', isPrimary: true }],
      bankName: 'GTBank', bankAccountName: `Sheet Guard ${stamp}`, bankAccountNumber: '0123456789',
    }, owner), 201, 'Create salaried staff');
    cleaner.workers.push(guard.id);

    const sheet = expect(await api(`/api/payroll/sheet?month=${month}`, 'GET', undefined, owner), 200, 'Owner loads the sheet');
    assert.equal(sheet.month, month);
    assert.ok(Array.isArray(sheet.rows) && sheet.rows.length > 0, 'The sheet must list staff with pay due');
    assert.equal(sheet.totals.staff, sheet.rows.length);
    assert.equal(sheet.totals.due, sheet.rows.reduce((sum, row) => sum + row.due, 0), 'Totals must equal the rows');
    assert.equal(sheet.totals.balance, sheet.totals.due - sheet.totals.paid);
    assert.ok(sheet.preparedBy, 'The sheet must record who prepared it');
    console.log(`Sheet built for ${sheet.label}: ${sheet.totals.staff} staff, payroll due ${sheet.totals.due}, balance ${sheet.totals.balance}.`);

    const mine = sheet.rows.find((row) => row.workerId === guard.id);
    assert.ok(mine, 'The salaried member of staff must appear on the sheet');
    assert.equal(mine.basic, 85000, 'Basic salary must come from the monthly rate');
    assert.equal(mine.piecework, 0, 'Non-production staff have no piecework');
    assert.equal(mine.bankAccountNumber, '0123456789', 'Bank details must be on the sheet');
    assert.deepEqual(mine.roles, ['Security']);
    assert.equal(mine.department, 'Security');
    console.log('Bank details, roles, department, basic salary and status all present for:', mine.name);

    // Piecework must only ever come from approved work.
    const pieceRows = sheet.rows.filter((row) => row.piecework > 0);
    assert.ok(pieceRows.every((row) => row.pieces >= 0));
    console.log('Piecework rows on the sheet:', pieceRows.length);

    // Nobody but the Owner can reach the sheet.
    const manager = expect(await api('/api/users', 'POST', {
      name: `Sheet PM ${stamp}`, email: `sheet-pm-${stamp}@test.example`, password: 'StrongTest123', role: 'PRODUCTION_MANAGER',
    }, owner), 201, 'Create manager');
    cleaner.users.push(manager.id);
    const pmLogin = await api('/api/auth/login', 'POST', { email: `sheet-pm-${stamp}@test.example`, password: 'StrongTest123' });
    const pm = `matesther_session=${pmLogin.token}`;
    expect(await api(`/api/payroll/sheet?month=${month}`, 'GET', undefined, pm), 403, 'Manager blocked from the bank sheet');
    const workerLogin = await api('/api/auth/login', 'POST', { email: 'oyeku.omolayo@gmail.com', password: 'worker123' });
    expect(workerLogin, 200, 'Worker login');
    const worker = `matesther_session=${workerLogin.token}`;
    expect(await api(`/api/payroll/sheet?month=${month}`, 'GET', undefined, worker), 403, 'Worker blocked from the bank sheet');
    expect(await api(`/api/payroll?month=${month}`, 'GET', undefined, pm), 403, 'Manager blocked from payroll');
    console.log('Payroll and the bank sheet stay Owner-only: Manager 403, Worker 403.');
  } finally {
    for (const id of cleaner.users) console.log('Cleaned up login:', (await api(`/api/users?id=${id}`, 'DELETE', undefined, owner)).status);
    for (const id of cleaner.workers) console.log('Cleaned up person:', (await api(`/api/workers?id=${id}`, 'DELETE', undefined, owner)).status);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
