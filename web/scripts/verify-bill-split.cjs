// Isolated browser + PostgreSQL smoke test. Never starts or connects to Supabase.
// Optional tools: NODE_PATH=/tmp/instant-319-sql-test/node_modules node web/scripts/verify-bill-split.cjs
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  let backend, vite, browser;
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA extensions;
      CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE public.profiles(id uuid PRIMARY KEY, full_name text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';`);
    for (const migration of ['20261003100000_add_bill_split_sessions.sql', '20261004100000_add_guest_bill_split_create.sql']) {
      await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8'));
    }
    await db.exec('SET ROLE anon');
    let creates = 0;
    let failNextCreate = false;
    backend = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'apikey,authorization,content-type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      res.setHeader('Content-Type', 'application/json');
      try {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        let query, args;
        switch (req.url) {
          case '/rest/v1/rpc/create_guest_bill_split_session':
            creates++;
            if (failNextCreate) { failNextCreate = false; throw new Error('Simulated failure'); }
            query = 'SELECT public.create_guest_bill_split_session($1,$2,$3,$4,$5) AS value';
            args = [body.p_amount_minor, body.p_currency, body.p_people, body.p_mode, body.p_values];
            break;
          case '/rest/v1/rpc/confirm_bill_split_share':
            query = 'SELECT public.confirm_bill_split_share($1,$2) AS value';
            args = [body.p_token, body.p_participant_id]; break;
          case '/rest/v1/rpc/get_bill_split_session':
            query = 'SELECT public.get_bill_split_session($1) AS value'; args = [body.p_token]; break;
          default: throw new Error('Unexpected RPC');
        }
        const result = await db.query(query, args);
        res.end(JSON.stringify(result.rows[0].value));
      } catch { res.writeHead(400); res.end(JSON.stringify({ message: 'Invalid request' })); }
    });
    await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
    const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
    vite = await createServer({ root: path.join(root, 'web'), envDir: false, logLevel: 'silent',
      define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:' + backend.address().port),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-test-public-key'), 'import.meta.env.VITE_POSTHOG_KEY': '""' },
      server: { host: '127.0.0.1', port: 0 } });
    await vite.listen();
    const base = 'http://127.0.0.1:' + vite.httpServer.address().port;
    const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await chromium.launch({ ...(fs.existsSync(systemChrome) ? { executablePath: systemChrome } : {}), headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const externalRequests = [];
    await context.route('**/*', route => {
      const origin = new URL(route.request().url()).origin;
      if ([base, 'http://127.0.0.1:' + backend.address().port].includes(origin)) return route.continue();
      externalRequests.push(origin); return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('400 (Bad Request)')) errors.push(msg.text()); });
    for (const [mode, values, expected] of [['equal', [], [334,334,333]], ['shares', ['1','2','3'], [167,334,500]], ['unequal', ['2.01','3.00','5.00'], [201,300,500]]]) {
      await page.goto(base + '/split');
      assert.equal(await page.getByLabel('Split mode').inputValue(), 'equal');
      await page.getByLabel('Total amount').fill('10.01');
      await page.getByLabel('Your name', { exact: true }).fill('Alex');
      await page.getByLabel('Person 2', { exact: true }).fill('Sam');
      await page.getByRole('button', { name: 'Add person', exact: true }).click();
      await page.getByLabel('Person 3', { exact: true }).fill('Lee');
      await page.getByLabel('Split mode').selectOption(mode);
      for (let i = 0; i < values.length; i++) await page.getByLabel(`${mode === 'shares' ? 'Shares' : 'Amount'} for person ${i + 1}`, { exact: true }).fill(values[i]);
      if (mode === 'unequal') {
        const before = creates;
        await page.getByLabel('Amount for person 3', { exact: true }).fill('4.99');
        await page.getByRole('button', { name: 'Create split', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Exact amounts must add up' }).waitFor();
        assert.equal(creates, before);
        await page.getByLabel('Amount for person 3', { exact: true }).fill('5.00');
      }
      if (mode === 'equal') {
        failNextCreate = true;
        await page.getByRole('button', { name: 'Create split', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Could not create' }).waitFor();
        assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Alex');
      }
      for (const width of [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      }
      if (mode === 'equal' && process.argv.includes('--screenshots')) {
        assert.equal(await page.getByRole('heading', { name: 'Split a bill', exact: true }).count(), 1);
        assert.equal(await page.getByRole('main').count(), 1);
        await page.getByLabel('Total amount').focus();
        await page.getByRole('heading', { name: 'Split a bill', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: '/tmp/sharedmoney-split-desktop.png' });
        await page.setViewportSize({ width: 320, height: 844 });
        await page.screenshot({ path: '/tmp/sharedmoney-split-mobile.png' });
      }
      await page.getByRole('button', { name: 'Create split', exact: true }).click();
      await page.waitForURL(/\/split\/[a-f0-9]{64}$/);
      await page.getByText('Find your name and confirm your share.', { exact: false }).waitFor();
      const shareUrl = await page.getByLabel('Bill share link').inputValue();
      assert.equal(shareUrl, page.url());
      await page.getByRole('button', { name: 'Copy link', exact: true }).click();
      await page.getByText(/Link copied\.|Select and copy the link above/).waitFor();
      const guest = await context.newPage();
      await guest.goto(shareUrl);
      await guest.getByRole('button', { name: 'Confirm my share as Sam', exact: true }).waitFor();
      const rows = guest.locator('.bill-split-people li');
      assert.equal(await rows.count(), 3);
      for (let i = 0; i < 3; i++) assert.ok((await rows.nth(i).innerText()).includes('USD ' + (expected[i] / 100).toFixed(2)));
      await guest.getByRole('button', { name: 'Confirm my share as Sam', exact: true }).click();
      await guest.getByText('Your share is confirmed. No money has moved.', { exact: true }).waitFor();
      await guest.reload();
      await guest.getByRole('button', { name: 'Sam, confirmed', exact: true }).waitFor();
      assert.equal(await guest.getByRole('button', { name: 'Sam, confirmed', exact: true }).isDisabled(), true);
      await guest.close();
    }
    assert.equal(creates, 4); // Three bills, plus the deliberately failed attempt.
    await page.goto(base + '/split/'); await page.getByRole('button', { name: 'Create split', exact: true }).waitFor();
    for (const suffix of ['invalid', '00'.repeat(32)]) {
      await page.goto(base + '/split/' + suffix); await page.getByRole('heading', { name: 'Bill not found' }).waitFor();
    }
    await page.goto(base + '/'); await page.locator('.landing-page').waitFor();
    await page.goto(base + '/split-bills'); await page.locator('.route-hero').waitFor();
    const routing = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    assert.equal(routing.redirects.find(r => r.source === '/join/:token').destination, '/app/join/:token');
    assert.equal(externalRequests.length, 0, externalRequests.join('\n'));
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Browser smoke passed: anonymous create/read/confirm in all modes; retry; exact validation; share links; reload persistence; 320–1440px layouts; invalid routes; SEO; no external requests or unexpected console errors.');
  } finally {
    if (browser) await browser.close(); if (vite) await vite.close();
    if (backend) await new Promise(resolve => backend.close(resolve)); await db.close();
  }
})().catch(error => { console.error(String(error).replace(/[a-f0-9]{64}/g, '[redacted]')); process.exitCode = 1; });
