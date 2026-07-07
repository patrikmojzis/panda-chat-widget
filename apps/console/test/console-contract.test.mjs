import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/console-api.ts', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const viteConfigSource = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');

test('console package exposes Vite scripts including typecheck and check', () => {
  assert.equal(packageJson.name, '@panda-chat-widget/console');
  assert.equal(packageJson.scripts.dev, 'vite --host 127.0.0.1 --port 5174');
  assert.equal(packageJson.scripts.build, 'tsc -p tsconfig.json --noEmit --pretty false && vite build');
  assert.equal(packageJson.scripts.test, 'node --test "test/**/*.test.mjs"');
  assert.match(packageJson.scripts.typecheck, /tsc -p tsconfig\.json --noEmit --pretty false/);
  assert.equal(packageJson.scripts.check, 'pnpm typecheck && pnpm lint && pnpm test && pnpm build');
  assert.equal(packageJson.dependencies.react, '^19.2.7');
  assert.equal(packageJson.dependencies['react-dom'], '^19.2.7');
});

test('console has a Vite HTML entry and React root', () => {
  assert.match(indexHtml, /<div id="root"><\/div>/);
  assert.match(indexHtml, /type="module" src="\/src\/main\.tsx"/);
  assert.match(mainSource, /createRoot\(rootElement\)\.render/);
  assert.match(mainSource, /<StrictMode>/);
  assert.match(mainSource, /<App \/>/);
  assert.match(viteConfigSource, /base: '\/console\/'/);
  assert.match(viteConfigSource, /port: 5174/);
  assert.match(viteConfigSource, /proxy/);
});

test('console API client uses relative /api routes, cookie credentials, and CSRF header for unsafe calls', () => {
  assert.match(apiSource, /getCurrentContext\(\): Promise<CurrentContext> \{\n  return apiRequest\('\/api\/me'\);/);
  assert.doesNotMatch(apiSource, /apiRequest\('\/me'\)/);
  assert.match(apiSource, /setupFirstOwner[\s\S]*'\/api\/auth\/setup'/);
  assert.match(apiSource, /login[\s\S]*'\/api\/auth\/login'/);
  assert.match(apiSource, /logout[\s\S]*'\/api\/auth\/logout'/);
  assert.match(apiSource, /credentials: 'include'/);
  assert.match(apiSource, /headers\['x-panda-csrf'\] = '1'/);
  assert.doesNotMatch(apiSource, /localStorage|sessionStorage|document\.cookie|Authorization|Bearer/);
});

test('console UI includes setup, login, protected shell, and visible workspace/user context', () => {
  assert.match(appSource, /First owner setup/);
  assert.match(appSource, /Create your workspace/);
  assert.match(appSource, /Owner login/);
  assert.match(appSource, /Sign in to your console/);
  assert.match(appSource, /context\.workspace\.name/);
  assert.match(appSource, /context\.user\.email/);
  assert.match(appSource, /Console shell ready/);
  assert.match(appSource, /role="alert"/);
  assert.match(appSource, /autoFocus/);
  assert.doesNotMatch(`${appSource}\n${apiSource}`, /billing|plans|usage|invite|RBAC|Gateway|SalesPanda|CRM/i);
});

test('console shell CSS uses semantic tokens and overflow-safe layout boundaries', () => {
  assert.match(stylesSource, /--background:/);
  assert.match(stylesSource, /--foreground:/);
  assert.match(stylesSource, /--sidebar:/);
  assert.match(stylesSource, /\.console-shell \{[\s\S]*min-width: 0;[\s\S]*min-height: 100dvh;[\s\S]*grid-template-columns: 280px minmax\(0, 1fr\);/);
  assert.match(stylesSource, /\.console-main \{[\s\S]*min-width: 0;[\s\S]*overflow-x: hidden;/);
  assert.match(stylesSource, /overflow-wrap: anywhere;/);
  assert.match(stylesSource, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(stylesSource, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|cssText|url\(/);
});
