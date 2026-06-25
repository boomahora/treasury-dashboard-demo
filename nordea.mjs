// Nordea Open Banking — Business AIS sandbox client.
// The proven flow: authorize (JSON body) -> token -> accounts -> per-account transactions.
// Sandbox skips request signing via the SKIP_SIGNATURE_VALIDATION_FOR_SANDBOX flag.
// Zero dependencies (Node 20+ native fetch).

import { readFileSync } from 'node:fs';

// ---- tiny .env loader (no dep) ----
try {
  for (const line of readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* rely on real env */ }

const BASE          = process.env.NORDEA_BASE   || 'https://api.nordeaopenbanking.com';
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI  = process.env.REDIRECT_URI  || 'https://example.com/callback';
const COUNTRY       = process.env.COUNTRY       || 'NO';
const SCOPE         = process.env.SCOPE         || 'ACCOUNTS_BASIC,ACCOUNTS_BALANCES,ACCOUNTS_DETAILS,ACCOUNTS_TRANSACTIONS';
const DURATION      = process.env.DURATION      || '129600';
const AUTH_PREFIX   = process.env.AUTH_PREFIX   || '/business/v5';
const AIS_PREFIX    = process.env.AIS_PREFIX    || '/business/v4';
const HOST          = new URL(BASE).host;

export function assertCreds() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Missing CLIENT_ID / CLIENT_SECRET — copy .env.example to .env and fill them in.');
  }
}

// Nordea requires every request to be signed. In SANDBOX this literal flag skips
// real signing — certificates/signing are only needed in production.
function baseHeaders() {
  return {
    'X-IBM-Client-Id': CLIENT_ID,
    'X-IBM-Client-Secret': CLIENT_SECRET,
    'Signature': 'SKIP_SIGNATURE_VALIDATION_FOR_SANDBOX',
    'X-Nordea-Originating-Host': HOST,
    'X-Nordea-Originating-Date': new Date().toUTCString(),
  };
}

async function authorize() {
  const body = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE.split(',').map((s) => s.trim()),
    duration: Number(DURATION),
    state: 'banksnipe-' + Date.now(),
    country: COUNTRY,
  };
  const res = await fetch(`${BASE}${AUTH_PREFIX}/authorize`, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  const loc = res.headers.get('location') || '';
  let code = new URL(loc, BASE).searchParams.get('code');
  if (!code) { try { code = JSON.parse(text)?.code || JSON.parse(text)?.response?.code; } catch {} }
  if (!code) throw new Error(`authorize failed (HTTP ${res.status}): ${text.slice(0, 400)}`);
  return code;
}

async function token(code) {
  const res = await fetch(`${BASE}${AUTH_PREFIX}/authorize/token`, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.access_token) throw new Error(`token failed (HTTP ${res.status})`);
  return json.access_token;
}

async function getRaw(accessToken, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...baseHeaders(), Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`GET ${path} failed (HTTP ${res.status})`);
  return json;
}

async function getJSON(accessToken, path) {
  return (await getRaw(accessToken, path))?.response ?? {};
}

// Page through the transactions endpoint (follows continuation_key) to build a
// real multi-day history rather than just the first page.
async function fetchTransactions(accessToken, acctId, { maxPages = 12, maxTx = 400 } = {}) {
  const base = `${AIS_PREFIX}/accounts/${encodeURIComponent(acctId)}/transactions`;
  let all = [];
  let key = null;
  for (let p = 0; p < maxPages; p++) {
    const path = base + (key ? `?continuation_key=${encodeURIComponent(key)}` : '');
    const json = await getRaw(accessToken, path);
    const txs = json?.response?.transactions || [];
    all = all.concat(txs);
    key = json?.group_header?.message_pagination?.continuation_key;
    if (!key || txs.length === 0 || all.length >= maxTx) break;
  }
  return all.slice(0, maxTx).map(normaliseTx);
}

const num = (v) => (v == null || v === '' ? 0 : Number(v));

function normaliseAccount(a) {
  const numbers = a.account_numbers || [];
  const find = (t) => numbers.find((n) => n._type === t)?.value || '';
  return {
    id: a._id,
    name: a.account_name,
    holder: a.account_holder || a.account_name,
    type: a.account_type,
    product: a.product,
    currency: a.currency,
    iban: find('IBAN'),
    bban: find('BBAN_NO') || find('BBAN'),
    bic: a.bank?.bic || '',
    bankName: a.bank?.name || 'Nordea',
    country: a.country,
    available: num(a.available_balance),
    booked: num(a.booked_balance),
    status: a.status,
  };
}

function normaliseTx(t) {
  return {
    id: t.transaction_id,
    date: t.booking_date || t.transaction_date,
    narrative: t.narrative || t.type_description || '',
    type: t.type_description || '',
    counterparty: t.counterparty_name || '',
    amount: num(t.amount),
    currency: t.currency,
  };
}

// Reconstruct end-of-day balances from the current available balance + the
// transaction history. eod(day) = current - (net of all days after that day).
function buildBalanceHistory(acct) {
  const txs = acct.transactions || [];
  if (!txs.length) return [];
  const byDay = {};
  for (const t of txs) byDay[t.date] = (byDay[t.date] || 0) + t.amount;
  const days = Object.keys(byDay).sort(); // ascending YYYY-MM-DD
  const eod = {};
  let suffix = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    eod[days[i]] = acct.available - suffix;
    suffix += byDay[days[i]];
  }
  return days.map((d) => ({ date: d, net: Math.round(byDay[d] * 100) / 100, balance: Math.round(eod[d] * 100) / 100 }));
}

// High-level: run the whole flow and return normalised, dashboard-ready data.
export async function fetchAll({ maxTx = 400 } = {}) {
  assertCreds();
  const accessToken = await token(await authorize());

  const list = (await getJSON(accessToken, `${AIS_PREFIX}/accounts`)).accounts || [];
  const accounts = [];
  for (const raw of list) {
    const acct = normaliseAccount(raw);
    try {
      acct.transactions = await fetchTransactions(accessToken, acct.id, { maxTx });
    } catch {
      acct.transactions = [];
    }
    acct.history = buildBalanceHistory(acct);
    accounts.push(acct);
  }

  const currencyTotals = {};
  for (const a of accounts) currencyTotals[a.currency] = (currencyTotals[a.currency] || 0) + a.available;

  return {
    generatedAt: new Date().toISOString(),
    bank: accounts[0]?.bankName || 'Nordea',
    environment: 'sandbox',
    currencyTotals,
    accounts,
  };
}
