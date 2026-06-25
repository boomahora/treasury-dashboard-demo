#!/usr/bin/env node
// Nordea Open Banking — Business AIS sandbox: pull accounts + balances + transactions.
// Zero dependencies (Node 20+ native fetch). Run: `node fetch-data.mjs`
//
// Flow:
//   1. POST /authorize        -> 302 redirect, ?code=... in Location (sandbox mock-authorizer skips login)
//   2. POST /authorize/token  -> { access_token, ... }
//   3. GET  /accounts         -> list; then per-account balances + transactions
//
// Fill in .env (copy from .env.example) with CLIENT_ID / CLIENT_SECRET / etc.

import { readFileSync } from 'node:fs';

// ---- tiny .env loader (no dep) ----
try {
  for (const line of readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env, rely on real env */ }

const BASE          = process.env.NORDEA_BASE   || 'https://api.nordeaopenbanking.com';
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI  = process.env.REDIRECT_URI  || 'https://treasury.banksnipe.com/callback';
const COUNTRY       = process.env.COUNTRY       || 'NO';            // NO | SE | FI | DK
const SCOPE         = process.env.SCOPE         || 'ACCOUNTS_BASIC,ACCOUNTS_BALANCES,ACCOUNTS_DETAILS,ACCOUNTS_TRANSACTIONS';
const DURATION      = process.env.DURATION      || '129600';
const AUTHORIZER_ID = process.env.SANDBOX_AUTHORIZER_ID || '';      // sandbox mock PSU id (from portal docs)

// Auth API is v5, AIS API is v4 (override via .env if a 404 says otherwise).
const AUTH_PREFIX = process.env.AUTH_PREFIX || '/business/v5';
const AIS_PREFIX  = process.env.AIS_PREFIX  || '/business/v4';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('✗ Missing CLIENT_ID / CLIENT_SECRET. Copy .env.example to .env and fill them in.');
  process.exit(1);
}

const HOST = new URL(BASE).host;

// Nordea requires every request to be signed. In SANDBOX you can skip real
// signing with this literal flag (certs/signing are only needed in production).
function baseHeaders() {
  return {
    'X-IBM-Client-Id': CLIENT_ID,
    'X-IBM-Client-Secret': CLIENT_SECRET,
    'Signature': 'SKIP_SIGNATURE_VALIDATION_FOR_SANDBOX',
    'X-Nordea-Originating-Host': HOST,
    'X-Nordea-Originating-Date': new Date().toUTCString(),
  };
}

function show(label, res, body) {
  console.log(`\n── ${label} → HTTP ${res.status} ${res.statusText}`);
  const loc = res.headers.get('location');
  if (loc) console.log('   Location:', loc);
  if (body) console.log(typeof body === 'string' ? body.slice(0, 1200) : JSON.stringify(body, null, 2).slice(0, 2000));
}

async function step1_authorize() {
  // v5 authorize takes its parameters as a JSON body (not query string).
  const body = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE.split(',').map((s) => s.trim()),
    duration: Number(DURATION),
    state: 'banksnipe-' + Date.now(),
    country: COUNTRY,
  };
  const headers = { ...baseHeaders(), 'Content-Type': 'application/json' };
  if (AUTHORIZER_ID) headers['X-Nordea-Sandbox-Authorizer-Id'] = AUTHORIZER_ID;

  const res = await fetch(`${BASE}${AUTH_PREFIX}/authorize`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  show('1. authorize', res, text);

  // code may arrive in the Location redirect, or in a JSON body, depending on flow
  const loc = res.headers.get('location') || '';
  let code = new URL(loc, BASE).searchParams.get('code');
  if (!code) { try { code = JSON.parse(text)?.code || JSON.parse(text)?.response?.code; } catch {} }
  if (!code) throw new Error('No authorization code found — inspect the response above (login page? different header/param?).');
  console.log('   ✓ got code:', code.slice(0, 12) + '…');
  return code;
}

async function step2_token(code) {
  const res = await fetch(`${BASE}${AUTH_PREFIX}/authorize/token`, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
  });
  const body = await res.json().catch(() => res.text());
  show('2. token', res, body);
  const token = body?.access_token;
  if (!token) throw new Error('No access_token returned.');
  console.log('   ✓ got access_token');
  return token;
}

async function get(token, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...baseHeaders(), Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => res.text());
  show(`GET ${path}`, res, body);
  return body;
}

async function main() {
  console.log('Nordea sandbox →', BASE, `(country ${COUNTRY})`);
  const code  = await step1_authorize();
  const token = await step2_token(code);

  const accounts = await get(token, `${AIS_PREFIX}/accounts`);
  const list = accounts?.response?.accounts || accounts?.accounts || [];
  console.log(`\n   ✓ ${list.length} account(s) found`);

  if (list[0]) {
    const id = list[0]._id || list[0].account_id || list[0].id;
    if (id) {
      await get(token, `${AIS_PREFIX}/accounts/${encodeURIComponent(id)}`);
      await get(token, `${AIS_PREFIX}/accounts/${encodeURIComponent(id)}/transactions`);
    }
  }
  console.log('\n✓ done.');
}

main().catch((e) => { console.error('\n✗', e.message); process.exit(1); });
