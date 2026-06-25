#!/usr/bin/env node
// peek.mjs — the smallest possible "see your data" script for the BankSnipe tutorial.
// Connects to the Nordea Open Banking sandbox and prints your accounts + balances.
//
//   node peek.mjs <CLIENT_ID> <CLIENT_SECRET>
//
// Self-contained: zero dependencies, Node 18+ (uses built-in fetch). No .env, no clone.
// On success it also saves your two keys to ~/.banksnipe-nordea.env so the dashboard
// step (npm start) can reuse them without you re-entering anything.

import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CLIENT_ID     = process.argv[2] || process.env.CLIENT_ID;
const CLIENT_SECRET = process.argv[3] || process.env.CLIENT_SECRET;
const KEYS_FILE     = join(homedir(), '.banksnipe-nordea.env');

const BASE     = 'https://api.nordeaopenbanking.com';
const REDIRECT = 'https://example.com/callback';
const HOST     = 'api.nordeaopenbanking.com';

if (!CLIENT_ID || !CLIENT_SECRET || /^paste-/.test(CLIENT_ID)) {
  console.error('\n  Add your two keys, like this:\n');
  console.error('    node peek.mjs YOUR_CLIENT_ID YOUR_CLIENT_SECRET\n');
  console.error('  (copy them from your Nordea app page — Client ID first, then Client Secret)\n');
  process.exit(1);
}

// Sandbox skips request signing with this literal flag; production needs a real certificate.
const headers = () => ({
  'X-IBM-Client-Id': CLIENT_ID,
  'X-IBM-Client-Secret': CLIENT_SECRET,
  'Signature': 'SKIP_SIGNATURE_VALIDATION_FOR_SANDBOX',
  'X-Nordea-Originating-Host': HOST,
  'X-Nordea-Originating-Date': new Date().toUTCString(),
});

const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function run() {
  // 1. Prove who you are -> the bank hands back a one-time code.
  const authRes = await fetch(`${BASE}/business/v5/authorize`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    redirect: 'manual',
    body: JSON.stringify({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      scope: ['ACCOUNTS_BASIC', 'ACCOUNTS_BALANCES', 'ACCOUNTS_DETAILS', 'ACCOUNTS_TRANSACTIONS'],
      duration: 129600,
      state: 'banksnipe',
      country: 'NO',
    }),
  });
  const loc = authRes.headers.get('location') || '';
  const code = new URL(loc, BASE).searchParams.get('code');
  if (!code) {
    if (authRes.status === 401) fail('Those keys were rejected (401). Double-check the Client ID and Client Secret from your Nordea app page.');
    fail(`Could not get an authorization code (HTTP ${authRes.status}).`);
  }

  // 2. Swap the code for an access token.
  const tokRes = await fetch(`${BASE}/business/v5/authorize/token`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
  });
  const token = (await tokRes.json().catch(() => ({}))).access_token;
  if (!token) fail(`Could not get an access token (HTTP ${tokRes.status}).`);

  // 3. Use the token to read your accounts.
  const acctRes = await fetch(`${BASE}/business/v4/accounts`, {
    headers: { ...headers(), Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  const data = await acctRes.json().catch(() => ({}));
  const accounts = data?.response?.accounts || [];

  console.log(`\n  A bank just answered you. ${accounts.length} account(s):\n`);
  for (const a of accounts) {
    const iban = (a.account_numbers || []).find((n) => n._type === 'IBAN')?.value || '';
    console.log(`   • ${a.account_name}  —  ${money(a.available_balance)} ${a.currency}   ${iban}`);
  }
  console.log('\n  And here is the bank\'s raw answer, exactly as it came back:\n');
  console.log(JSON.stringify(data, null, 2));

  // Save the keys in your home folder so the dashboard step can reuse them.
  try {
    writeFileSync(KEYS_FILE, `CLIENT_ID=${CLIENT_ID}\nCLIENT_SECRET=${CLIENT_SECRET}\n`, { mode: 0o600 });
    console.log(`\n  ✓ Saved your keys to ${KEYS_FILE}`);
    console.log('    so the dashboard can reuse them. Delete that file any time.\n');
  } catch { /* non-fatal: dashboard step can still use a .env */ }
}

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

run().catch((e) => fail(e.message));
