/* Local-only regression test for the multi-role people model. Never point at a
   production URL. Requires demo data in local Postgres + a running local server.

   Covers:
   - one person record holding Cutter + Tailor + Inspection Officer roles
   - production assignments identify the role used
   - a multi-role worker's My Jobs shows jobs from every role they hold
   - separation of duties: nobody inspects their own submitted work
   - non-production staff (security) can be paid without a production specialty
   - per-piece pay is refused for non-production staff
   - payroll/company finances stay hidden from Project Managers   */
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:3000';
const stamp = Date.now();
async function api(path, method = 'GET', body, cookie, extraHeaders = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...extraHeaders },
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
  const cleaner = { workers: [], users: [], customers: [], orders: [] };
  try {
    // 1. ONE record, MANY roles: Cutter + Tailor + Inspection Officer.
    const multi = expect(await api('/api/workers', 'POST', {
      name: `Multi Role ${stamp}`, phone: '+234 800 000 0000', paymentType: 'PER_PIECE', paymentRate: 200,
      department: 'Tailoring floor',
      roles: [
        { role: 'Cutter', isPrimary: true },
        { role: 'Tailor' },
        { role: 'Inspection Officer' },
      ],
    }, owner), 201, 'Create multi-role worker');
    cleaner.workers.push(multi.id);
    assert.equal(multi.staffType, 'PRODUCTION');
    assert.deepEqual(multi.roles.map((row) => row.role).sort(), ['Cutter', 'Inspection Officer', 'Tailor']);
    assert.equal(multi.isInspector, true, 'inspection role must switch on the legacy inspector flag');
    console.log('Multi-role worker created with one record:', multi.roles.map((row) => `${row.role}(${row.kind})`).join(', '));

    // 2. Non-production staff: no production specialty needed, salaried.
    const guard = expect(await api('/api/workers', 'POST', {
      name: `Security ${stamp}`, paymentType: 'MONTHLY', paymentRate: 80000,
      department: 'Security', jobTitle: 'Security Guard',
      roles: [{ role: 'Security', isPrimary: true }],
    }, owner), 201, 'Create non-production staff');
    cleaner.workers.push(guard.id);
    assert.equal(guard.staffType, 'NON_PRODUCTION');
    assert.equal(guard.specialty, 'Security');
    console.log('Non-production staff saved without any production specialty:', guard.name, guard.staffType);

    // 3. Per-piece pay is refused for non-production staff.
    expect(await api('/api/workers', 'POST', {
      name: `Per Piece Guard ${stamp}`, paymentType: 'PER_PIECE', paymentRate: 50,
      roles: [{ role: 'Security' }],
    }, owner), 400, 'Per-piece refused for non-production staff');
    console.log('Per-piece pay correctly refused for non-production staff.');

    // 4. A login for the multi-role person (one record, one login).
    const login = expect(await api('/api/users', 'POST', {
      name: multi.name, email: `multi-${stamp}@test.example`, password: 'StrongTest123',
      role: 'PRODUCTION_MANAGER', workerId: multi.id,
    }, owner), 201, 'Create linked manager login');
    cleaner.users.push(login.id);
    const signIn = await api('/api/auth/login', 'POST', { email: `multi-${stamp}@test.example`, password: 'StrongTest123' });
    expect(signIn, 200, 'Multi-role manager login');
    const multiCookie = `matesther_session=${signIn.token}`;

    // 5. A cutter-supervisor may not assign cutting (existing rule, now role-aware).
    const school = expect(await api('/api/customers', 'POST', { name: `School ${stamp}`, type: 'SCHOOL' }, owner), 201, 'Temporary school');
    cleaner.customers.push(school.id);
    const order = expect(await api('/api/orders', 'POST', {
      orderNumber: `ORD-MR-${stamp}`, customerId: school.id, orderDate: '2026-10-01', dueDate: '2026-11-01',
      items: [{ productId: 1, quantity: 8, unitPrice: 4500 }],
    }, owner), 201, 'Temporary order');
    cleaner.orders.push(order.id);
    const catalog = expect(await api('/api/production-orders', 'GET', undefined, multiCookie), 200, 'Production order catalogue');
    const item = catalog.find((entry) => entry.id === order.id)?.items[0];
    assert.ok(item, 'Order item must be visible to production staff');

    const assignment = { orderId: order.id, orderItemId: item.id, quantity: 4, size: 'M', color: 'Navy', expectedCompletionDate: '2026-10-25' };
    expect(await api('/api/batches', 'POST', { ...assignment, workerId: multi.id, cuttingRate: 150 }, multiCookie), 403, 'Cutter-supervisor cannot assign cutting');
    const batch = expect(await api('/api/batches', 'POST', { ...assignment, tailorId: multi.id, sewingRate: 300 }, multiCookie), 201, 'Cutter-supervisor assigns their own Tailor role');
    console.log('Role-aware cutting rule held; the same person was assignable as a Tailor on the batch.');

    // 6. The assignment records which role the work is for.
    const ops = expect(await api(`/api/operations?orderId=${order.id}`, 'GET', undefined, multiCookie), 200, 'Batch operations');
    const sewing = ops.find((op) => op.productionBatchId === batch.id && op.stage === 'SEWING');
    assert.equal(sewing.workerId, multi.id);
    assert.equal(sewing.roleLabel, 'Tailor');
    console.log('Assignment stored the role used (roleLabel):', sewing.roleLabel);

    // 7. Owner assigns the Cutting stage to the same person (their Cutter role).
    const cutting = ops.find((op) => op.productionBatchId === batch.id && op.stage === 'CUTTING');
    assert.ok(cutting, 'Cutting stage must exist');
    expect(await api('/api/operations', 'PUT', { id: cutting.id, workerId: multi.id, pieceRate: 150, status: 'IN_PROGRESS' }, owner), 200, 'Owner assigns the person as Cutter');
    const opsAfter = expect(await api(`/api/operations?orderId=${order.id}`, 'GET', undefined, multiCookie), 200, 'Operations after assignment');
    assert.equal(opsAfter.find((op) => op.id === cutting.id)?.roleLabel, 'Cutter');
    console.log('The same record now holds a Cutting job (roleLabel Cutter) and a Sewing job (roleLabel Tailor).');

    // 8. My Jobs shows every job held across their roles - one person, no duplicates.
    const myWork = expect(await api('/api/dashboard?view=my-work', 'GET', undefined, multiCookie), 200, 'Multi-role My Jobs');
    assert.ok(myWork.journal.some((job) => job.id === cutting.id), 'My Jobs must include their Cutter job');
    assert.ok(myWork.journal.some((job) => job.id === sewing.id), 'My Jobs must include their Tailor job');
    assert.equal('revenue' in myWork, false, 'Company finances must stay hidden');
    console.log('My Jobs lists both jobs from the single record; no company finances.');

    // 9. Submit their own cutting work, then prove self-inspection is blocked
    //    even though they hold an Inspection Officer role.
    expect(await api('/api/operations', 'PUT', { id: cutting.id, submitQty: 3 }, multiCookie), 200, 'Submit own work');
    expect(await api('/api/inspections', 'POST', {
      operationId: cutting.id, quantityApproved: 3, quantityRework: 0, quantityRejected: 0,
    }, multiCookie), 403, 'Self-inspection blocked for a Cutter + Tailor + Inspection Officer');
    console.log('A person holding an Inspection Officer role still cannot approve their own submitted work.');

    // 10. Another supervisor may inspect it.
    const other = expect(await api('/api/users', 'POST', {
      name: `Other Supervisor ${stamp}`, email: `other-${stamp}@test.example`, password: 'StrongTest123', role: 'PRODUCTION_MANAGER',
    }, owner), 201, 'Create other supervisor');
    cleaner.users.push(other.id);
    const otherLogin = await api('/api/auth/login', 'POST', { email: `other-${stamp}@test.example`, password: 'StrongTest123' });
    expect(otherLogin, 200, 'Other supervisor login');
    const otherCookie = `matesther_session=${otherLogin.token}`;
    const approved = expect(await api('/api/inspections', 'POST', {
      operationId: cutting.id, quantityApproved: 2, quantityRework: 1, quantityRejected: 0, notes: 'One panel to redo',
    }, otherCookie), 201, 'Another supervisor inspects');
    assert.equal(approved.inspector, other.name);
    console.log('Separate supervisor approved the Cutting work.');

    // Non-production staff never enter production eligibility.
    expect(await api('/api/operations', 'PUT', { id: sewing.id, workerId: guard.id, pieceRate: 100 }, owner), 400, 'Non-production staff cannot take production work');
    console.log('Security staff cannot be assigned to a production stage.');

    // 11. Project Managers never receive payroll or bank details.
    const manager = expect(await api('/api/users', 'POST', {
      name: `Plain Manager ${stamp}`, email: `pm-${stamp}@test.example`, password: 'StrongTest123', role: 'PRODUCTION_MANAGER',
    }, owner), 201, 'Create plain manager');
    cleaner.users.push(manager.id);
    const pmLogin = await api('/api/auth/login', 'POST', { email: `pm-${stamp}@test.example`, password: 'StrongTest123' });
    const pmCookie = `matesther_session=${pmLogin.token}`;
    const pmWorkers = expect(await api('/api/workers', 'GET', undefined, pmCookie), 200, 'Manager worker list');
    const seen = pmWorkers.find((person) => person.id === multi.id);
    assert.ok(seen, 'Manager should still see the worker');
    assert.equal('paymentRate' in seen, false, 'Manager must not see pay rates');
    assert.equal('earnings' in seen, false, 'Manager must not see earnings');
    assert.equal('bankAccountNumber' in seen, false, 'Manager must not see bank details');
    expect(await api('/api/production/../payroll'.replace('/production/..', ''), 'GET', undefined, pmCookie), 403, 'Manager has no payroll access');
    console.log('Project Manager saw roles for assignment but no pay, earnings or bank details.');
  } finally {
    for (const id of cleaner.orders) console.log('Cleaned up order:', (await api(`/api/orders/${id}`, 'DELETE', undefined, owner)).status);
    for (const id of cleaner.customers) console.log('Cleaned up school:', (await api(`/api/customers/${id}`, 'DELETE', undefined, owner)).status);
    for (const id of cleaner.users) console.log('Cleaned up login:', (await api(`/api/users?id=${id}`, 'DELETE', undefined, owner)).status);
    for (const id of cleaner.workers) console.log('Cleaned up person:', (await api(`/api/workers?id=${id}`, 'DELETE', undefined, owner)).status);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
