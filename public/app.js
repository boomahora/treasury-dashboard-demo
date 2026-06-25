// Treasury dashboard front-end. Tries the live API (/api/data); if that's not
// available (e.g. the static demo on treasury.banksnipe.com) it falls back to
// the frozen snapshot in demo-data.json.

const $ = (sel) => document.querySelector(sel);

function money(amount, currency) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency, currencyDisplay: 'code',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
}
function dateShort(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function esc(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

async function load() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    // static-demo fallback
    const res = await fetch('./demo-data.json');
    if (!res.ok) throw e;
    return await res.json();
  }
}

function statsHTML(data) {
  const totals = Object.entries(data.currencyTotals);
  const cards = totals.map(([ccy, total], i) => `
    <div class="stat ${i === 0 ? 'accent' : ''}">
      <div class="label">Cash position</div>
      <div class="figure">${money(total, ccy).replace(ccy, '').trim()}<span class="ccy">${ccy}</span></div>
    </div>`).join('');
  const accounts = `
    <div class="stat">
      <div class="label">Accounts</div>
      <div class="figure">${data.accounts.length}</div>
    </div>`;
  return `<div class="stats">${cards}${accounts}</div>`;
}

const GREEN = '#0e8455';

function dayTick(iso) { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); }
function compact(n, currency) {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? (n / 1000).toFixed(abs >= 100000 ? 0 : 1) + 'k' : Math.round(n).toString();
  return `${s} ${currency}`;
}

// Inline SVG area+line chart of the balance trend over time.
function balanceChart(acct) {
  const h = acct.history || [];
  if (h.length < 2) return `<div class="card"><div class="state">Not enough history to chart.</div></div>`;

  const W = 760, H = 240, padL = 56, padR = 16, padT = 18, padB = 30;
  const xAt = (i) => padL + i * ((W - padL - padR) / (h.length - 1));
  const bals = h.map((d) => d.balance);
  let lo = Math.min(...bals), hi = Math.max(...bals);
  const span = (hi - lo) || Math.abs(hi) || 1;
  lo -= span * 0.15; hi += span * 0.15;
  const yAt = (b) => padT + (1 - (b - lo) / (hi - lo)) * (H - padT - padB);

  const pts = h.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.balance).toFixed(1)}`);
  const line = pts.join(' ');
  const area = `M ${xAt(0).toFixed(1)},${(H - padB).toFixed(1)} L ${pts.join(' L ')} L ${xAt(h.length - 1).toFixed(1)},${(H - padB).toFixed(1)} Z`;

  // 3 horizontal gridlines across the real data range
  const grids = [0, 0.5, 1].map((t) => {
    const val = Math.min(...bals) + t * (Math.max(...bals) - Math.min(...bals));
    const y = yAt(val).toFixed(1);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e6e9ee"/>
            <text x="${padL - 8}" y="${(+y + 4).toFixed(1)}" text-anchor="end" class="ax">${compact(val, acct.currency)}</text>`;
  }).join('');

  // With many daily points dots and per-point labels get too dense, so only
  // show dots for short series and thin the x-axis ticks.
  const dots = h.length <= 30
    ? h.map((d, i) => `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(d.balance).toFixed(1)}" r="3" fill="${GREEN}"/>`).join('')
    : '';
  const step = Math.max(1, Math.ceil(h.length / 8));
  const xlabels = h
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i % step === 0 || i === h.length - 1)
    .map(({ d, i }) => `<text x="${xAt(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${dayTick(d.date)}</text>`)
    .join('');

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" class="lc">
    ${grids}
    <path d="${area}" fill="rgba(14,132,85,0.10)" stroke="none"/>
    <polyline points="${line}" fill="none" stroke="${GREEN}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${xlabels}
  </svg>`;

  // period summary
  const change = h.at(-1).balance - h[0].balance;
  const inflow = (acct.transactions || []).filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const outflow = (acct.transactions || []).filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  return `<div class="card chart">
    ${svg}
    <div class="chart-foot">
      <span class="muted mono">${h.length} days · ${dayTick(h[0].date)} → ${dayTick(h.at(-1).date)}</span>
      <span>Net change <b class="${change < 0 ? 'neg' : 'pos'}">${money(change, acct.currency)}</b></span>
      <span class="muted">In <b class="pos">${money(inflow, acct.currency)}</b></span>
      <span class="muted">Out <b class="neg">${money(outflow, acct.currency)}</b></span>
    </div>
  </div>`;
}

function accountsHTML(data) {
  const rows = data.accounts.map((a, i) => `
    <tr data-i="${i}" class="${i === 0 ? 'active' : ''}">
      <td><span class="acct-name">${esc(a.name)}</span><br><span class="muted mono">${esc(a.iban || a.bban)}</span></td>
      <td><span class="tag">${esc(a.type)}</span></td>
      <td class="mono muted">${esc(a.bic)}</td>
      <td class="num">${money(a.available, a.currency)}</td>
      <td class="num muted">${money(a.booked, a.currency)}</td>
    </tr>`).join('');
  return `<div class="card"><table>
    <thead><tr><th>Account</th><th>Type</th><th>BIC</th><th class="num">Available</th><th class="num">Booked</th></tr></thead>
    <tbody class="click" id="acct-body">${rows}</tbody>
  </table></div>`;
}

function txHTML(account) {
  const txs = account.transactions || [];
  if (!txs.length) return `<div class="card"><div class="state">No transactions in this account.</div></div>`;
  const rows = txs.map((t) => `
    <tr>
      <td class="mono muted">${dateShort(t.date)}</td>
      <td>${esc(t.counterparty || t.narrative)}<br><span class="muted mono">${esc(t.type)}</span></td>
      <td class="num ${t.amount < 0 ? 'neg' : 'pos'}">${money(t.amount, t.currency)}</td>
    </tr>`).join('');
  return `<div class="card"><table>
    <thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function render(data) {
  $('#conn').textContent = `${data.bank} · ${data.environment} · connected`;
  $('#synced').textContent = `synced ${new Date(data.generatedAt).toLocaleTimeString('en-GB')}`;

  let active = 0;
  const draw = () => {
    $('#app').innerHTML = `
      <h1 class="page-title">Cash position</h1>
      <p class="page-sub">Live from ${esc(data.bank)} Open Banking — ${data.accounts.length} corporate account(s).</p>
      ${statsHTML(data)}
      <div class="eyebrow">Balance trend — ${esc(data.accounts[active]?.name || '')}</div>
      ${balanceChart(data.accounts[active] || {})}
      <div class="eyebrow">Accounts</div>
      ${accountsHTML(data)}
      <div class="eyebrow">Transactions — ${esc(data.accounts[active]?.name || '')}</div>
      ${txHTML(data.accounts[active] || {})}
    `;
    const body = $('#acct-body');
    if (body) body.querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', () => { active = Number(tr.dataset.i); draw(); });
    });
  };
  draw();
}

load()
  .then(render)
  .catch((e) => {
    $('#conn').textContent = 'not connected';
    $('#app').innerHTML = `<div class="state"><p><b>Couldn't load data.</b></p><p class="mono">${esc(e.message)}</p>
      <p class="muted">Check your <code>.env</code> has CLIENT_ID and CLIENT_SECRET, and that the app is subscribed to Business Accounts Information.</p></div>`;
  });
