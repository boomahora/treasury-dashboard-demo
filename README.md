# Treasury dashboard — connect to a bank API in an afternoon

A tiny, zero-dependency treasury dashboard that pulls live cash positions, balances and
transactions from the **Nordea Open Banking sandbox** and lays them out like a tool you'd
actually use. Built to go with the walkthrough at
[banksnipe.com](https://banksnipe.com).

This is **sandbox** software: realistic test accounts, no real money, nothing can move.
It is a first small win, not a production system.

## What you need

- [Node](https://nodejs.org) 20+ and git. One-time install:
  - **macOS** (installs [Homebrew](https://brew.sh) first):
    ```
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    brew install node git
    ```
  - **Windows** (winget is built in):
    ```
    winget install OpenJS.NodeJS Git.Git
    ```
- A free Nordea developer account and an app with the **Business Accounts Information**
  product. Register at the [Nordea developer portal](https://developer.nordeaopenbanking.com).
  When it asks for an OAuth redirect URL, use `https://example.com/callback` (it just has to
  match `REDIRECT_URI` below; nothing actually loads there in the sandbox).

## Run it

```
git clone https://github.com/boomahora/treasury-dashboard-demo.git treasury-dashboard
cd treasury-dashboard
```

Rename `.env.example` to `.env` and paste in your Client ID and Secret.

See your data come back as raw JSON:

```
node fetch-data.mjs
```

Then start the dashboard:

```
npm start
```

Open the address it prints (http://localhost:3000). Your cash position, every account, a
balance trend for each one, transactions a click away. Your keys never leave your machine —
the script runs locally and talks straight to Nordea's sandbox.

## How it works

- `nordea.mjs` — the proven flow: authorize (JSON body) → token → accounts → transactions,
  with balance-history reconstruction and pagination. Sandbox skips request signing via the
  `SKIP_SIGNATURE_VALIDATION_FOR_SANDBOX` flag, so no certificates on day one.
- `fetch-data.mjs` — CLI that runs the flow and prints the JSON.
- `server.mjs` — zero-dependency web server; runs the flow server-side so your secret never
  reaches the browser.
- `public/` — the dashboard front-end.

## The next mountain

Reading **real** accounts in production needs request signing with a certificate and an
authorised account-information-provider licence (or a route through an aggregator or your
TMS). That shape doesn't change from what you see here — it's just the next step up.

## License

MIT
