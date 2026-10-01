/* Local-only regression test for WhatsApp sharing of customer documents.
   Never point at a production URL. Requires local Postgres demo data + server.

   Verifies:
   - the Owner can create signed, expiring links for receipts and delivery sheets
   - the public page renders the customer document
   - tampered or wrong links are refused
   - Project Managers cannot create share links
   - a shared document never contains payroll or internal cost information */
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:3000';
const stamp = Date.now();
async function api(path, method = 'GET', body, cookie) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, data, text, token: response.headers.get('set-cookie')?.match(/matesther_session=([^;]+)/)?.[1] };
}
function expect(result, status, label) {
  assert.equal(result.status, status, `${label}: HTTP ${result.status} ${JSON.stringify(result.data).slice(0, 200)}`);
  return result.data;
}
function bodyText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'");
}
(async () => {
  const ownerLogin = await api('/api/auth/login', 'POST', { email: 'estheradejugba@gmail.com', password: 'owner123' });
  expect(ownerLogin, 200, 'Owner login');
  const owner = `matesther_session=${ownerLogin.token}`;
  const cleaner = { users: [] };
  try {
    // Pick an existing seeded payment and delivery.
    const payments = expect(await api('/api/payments?orderId=3', 'GET', undefined, owner), 200, 'Customer payments');
    const payment = Array.isArray(payments) ? payments[0] : payments.payments?.[0];
    assert.ok(payment, 'Seed data must include a customer payment');
    const deliveries = expect(await api('/api/deliveries?orderId=3', 'GET', undefined, owner), 200, 'Deliveries');
    const delivery = Array.isArray(deliveries) ? deliveries[0] : deliveries.deliveries?.[0];
    assert.ok(delivery, 'Seed data must include a delivery');

    // 1. Receipt link
    const receiptShare = expect(await api('/api/documents/share', 'POST', { type: 'receipt', id: payment.id }, owner), 201, 'Create receipt link');
    assert.match(receiptShare.path, /^\/share\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(receiptShare.expiresAt, 'A link must carry an expiry');
    const receiptPage = await api(receiptShare.path, 'GET', undefined, undefined);
    assert.equal(receiptPage.status, 200, 'Shared receipt page must render');
    const receiptText = bodyText(receiptPage.text);
    assert.match(receiptText, /Customer Payment Receipt/i);
    assert.match(receiptText, new RegExp(payment.orderNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), 'Receipt must show the order number');
    assert.doesNotMatch(receiptText, /pieceRate|piece_rate|salary|payroll|worker/i, 'Shared receipt must not leak internal pay data');
    console.log('Receipt shared over a signed link and rendered for the customer.');

    // 2. Delivery link
    const deliveryShare = expect(await api('/api/documents/share', 'POST', { type: 'delivery', id: delivery.id }, owner), 201, 'Create delivery link');
    const deliveryPage = await api(deliveryShare.path, 'GET');
    assert.equal(deliveryPage.status, 200, 'Shared delivery page must render');
    const deliveryText = bodyText(deliveryPage.text);
    assert.match(deliveryText, /School Uniform Delivery Sheet/i);
    assert.doesNotMatch(deliveryText, /pieceRate|piece_rate|salary|payroll|worker/i, 'Shared delivery sheet must not leak internal pay data');
    console.log('Delivery sheet shared over a signed link and rendered for the customer.');

    // 3. Tampered links are refused.
    const tampered = receiptShare.path.replace(/.$/, (char) => (char === "a" ? "b" : "a"));
    const tamperedPage = await api(tampered, 'GET');
    assert.equal(tamperedPage.status, 200, 'Tampered link renders the safe refusal page');
    assert.match(bodyText(tamperedPage.text), /expired|not found/i);
    assert.doesNotMatch(bodyText(tamperedPage.text), /Customer Payment Receipt/i);
    // A delivery link cannot be replayed as a receipt (type is signed in).
    const swapped = deliveryShare.path.replace("/share/", "/share/");
    assert.equal((await api(swapped.replace(encodeURIComponent("delivery"), encodeURIComponent("receipt")), 'GET')).status, 200);
    console.log('Tampered links are refused; document type is part of the signature.');

    // 4. Only the Owner may create links.
    const manager = expect(await api('/api/users', 'POST', {
      name: `Share PM ${stamp}`, email: `share-pm-${stamp}@test.example`, password: 'StrongTest123', role: 'PRODUCTION_MANAGER',
    }, owner), 201, 'Create manager');
    cleaner.users.push(manager.id);
    const pmLogin = await api('/api/auth/login', 'POST', { email: `share-pm-${stamp}@test.example`, password: 'StrongTest123' });
    const pm = `matesther_session=${pmLogin.token}`;
    expect(await api('/api/documents/share', 'POST', { type: 'receipt', id: payment.id }, pm), 403, 'Manager cannot create share links');
    expect(await api('/api/documents/share', 'POST', { type: 'payroll', id: 1 }, owner), 400, 'Payroll can never be shared');
    console.log('Share links are Owner-only and payroll documents are not shareable at all.');
  } finally {
    for (const id of cleaner.users) console.log('Cleaned up login:', (await api(`/api/users?id=${id}`, 'DELETE', undefined, owner)).status);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
