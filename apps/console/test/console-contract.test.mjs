import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const componentsJson = JSON.parse(await readFile(new URL('../components.json', import.meta.url), 'utf8'));
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const indexCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const viteConfigSource = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
const utilsSource = await readFile(new URL('../src/lib/utils.ts', import.meta.url), 'utf8');

const uiDir = new URL('../src/components/ui/', import.meta.url);
const uiFiles = (await readdir(uiDir)).filter(f => f.endsWith('.tsx')).sort();

// Static inventory/shape claims that cannot be executed

test('components.json targets New York/neutral/Lucide', () => {
  assert.equal(componentsJson.style, 'new-york');
  assert.equal(componentsJson.rsc, false);
  assert.equal(componentsJson.tsx, true);
  assert.equal(componentsJson.tailwind.baseColor, 'neutral');
  assert.equal(componentsJson.tailwind.cssVariables, true);
  assert.equal(componentsJson.tailwind.css, 'src/index.css');
  assert.equal(componentsJson.iconLibrary, 'lucide');
  assert.equal(componentsJson.aliases.utils, '@/lib/utils');
  assert.equal(componentsJson.aliases.ui, '@/components/ui');
});

test('exactly 10 ui primitives with no extras', () => {
  const expected = ['alert.tsx','button.tsx','card.tsx','empty.tsx','input.tsx','label.tsx','separator.tsx','sheet.tsx','skeleton.tsx','spinner.tsx'];
  assert.deepEqual(uiFiles, expected);
});

test('console package has exact S3 runtime and dev dependencies', () => {
  const deps = packageJson.dependencies;
  assert.equal(deps['@radix-ui/react-dialog'], '1.1.15');
  assert.equal(deps['@radix-ui/react-label'], '2.1.8');
  assert.equal(deps['@radix-ui/react-separator'], '1.1.8');
  assert.equal(deps['@radix-ui/react-slot'], '1.2.4');
  assert.equal(deps['class-variance-authority'], '0.7.1');
  assert.equal(deps.clsx, '2.1.1');
  assert.equal(deps['lucide-react'], '0.545.0');
  assert.equal(deps['tailwind-merge'], '3.5.0');
  assert.equal(deps['tw-animate-css'], '1.4.0');
  assert.equal(Object.keys(deps).length, 11);
  const devDeps = packageJson.devDependencies;
  assert.equal(devDeps['@tailwindcss/vite'], '4.2.4');
  assert.equal(devDeps.tailwindcss, '4.2.4');
  assert.equal(Object.keys(devDeps).length, 5);
});

test('utils.ts contains only cn', () => {
  assert.match(utilsSource, /export function cn/);
  const exportCount = (utilsSource.match(/\bexport\b/g) || []).length;
  assert.equal(exportCount, 1);
});

test('index.css: tailwindcss + tw-animate-css, no dark/fonts, system stack', () => {
  assert.match(indexCss, /@import "tailwindcss"/);
  assert.match(indexCss, /@import "tw-animate-css"/);
  assert.match(indexCss, /--radius: 0\.625rem/);
  assert.match(indexCss, /--font-sans: ui-sans-serif, system-ui, sans-serif/);
  assert.doesNotMatch(indexCss, /\.dark\b/);
  assert.doesNotMatch(indexCss, /@font-face|url\(/);
});

test('no forbidden frameworks in console sources', () => {
  const all = [appSource, mainSource, indexCss].join('\n');
  assert.doesNotMatch(all, /shadcn\/tailwind|radix-vega|react-router|recharts|tanstack|react-hook-form|\bzod\b/);
});

test('console Vite scripts, HTML entry, React root', () => {
  assert.equal(packageJson.name, '@panda-chat-widget/console');
  assert.match(indexHtml, /<div id="root"><\/div>/);
  assert.match(mainSource, /createRoot\(rootElement\)\.render/);
  assert.match(viteConfigSource, /base: '\/console\/'/);
  assert.match(viteConfigSource, /port: 5174/);
  assert.match(viteConfigSource, /proxy/);
  assert.match(viteConfigSource, /tailwindcss/);
});

test('old styles.css is deleted', async () => {
  try { await readFile(new URL('../src/styles.css', import.meta.url), 'utf8'); assert.fail('styles.css should be deleted'); }
  catch (error) { assert.equal(error.code, 'ENOENT'); }
});

test('legacy compat layer is deleted and unreferenced', async () => {
  try { await readdir(new URL('../src/compat', import.meta.url)); assert.fail('src/compat should be deleted'); }
  catch (error) { assert.equal(error.code, 'ENOENT'); }
  assert.doesNotMatch([appSource, mainSource].join('\n'), /compat/i);
});

test('setup and login titles are native h1 headings', () => {
  assert.match(appSource, /<h1 className="font-semibold leading-none tracking-tight text-2xl">Create your workspace<\/h1>/);
  assert.match(appSource, /<h1 className="font-semibold leading-none tracking-tight text-2xl">Sign in to your console<\/h1>/);
  assert.doesNotMatch(appSource, /<CardTitle[^>]*>\s*(?:Create your workspace|Sign in to your console)\s*<\/CardTitle>/);
  assert.doesNotMatch(appSource, /<div[^>]*>\s*(?:Create your workspace|Sign in to your console)\s*<\/div>/);
});

test('widget public key uses min-w-0, not shrink-0', () => {
  assert.doesNotMatch(appSource, /shrink-0[^"]*break-all/);
  assert.match(appSource, /min-w-0[^"]*break-all/);
});

test('no storage or dark mode in app or main', () => {
  const all = [appSource, mainSource, indexCss].join('\n');
  assert.doesNotMatch(all, /localStorage|sessionStorage|document\.cookie/);
});

test('no fix-round markers in production source', () => {
  assert.doesNotMatch(appSource, /BLOCKER|SHOULD_FIX/);
});

test('responsive shell structure', () => {
  assert.match(appSource, /hidden md:flex/);
  assert.match(appSource, /md:grid-cols-\[16rem/);
  assert.match(appSource, /SheetTrigger/);
  assert.match(appSource, /setSheetOpen\(false\)/);
});

test('mobile Sheet navigation focus is one-shot, consumer-scoped, and timer-free', () => {
  assert.match(appSource, /type ReactNode, useEffect, useRef, useState/);
  assert.match(appSource, /const sheetNavigationFocusTargetRef = useRef<string \| null>\(null\);/);
  assert.match(appSource, /function navigateFromSheet\(path: string\) \{\s+sheetNavigationFocusTargetRef\.current = 'sites-title';\s+navigate\(path\);\s+\}/);
  assert.match(appSource, /function handleSheetOpenChange\(open: boolean\) \{\s+if \(open\) \{\s+sheetNavigationFocusTargetRef\.current = null;\s+\}\s+setSheetOpen\(open\);\s+\}/);
  assert.match(appSource, /function handleSheetCloseAutoFocus\(event: Event\) \{\s+const targetId = sheetNavigationFocusTargetRef\.current;\s+sheetNavigationFocusTargetRef\.current = null;\s+if \(!targetId\) return;\s+const target = document\.getElementById\(targetId\);\s+if \(!target\) return;\s+event\.preventDefault\(\);\s+target\.focus\(\{ preventScroll: true \}\);\s+\}/);
  assert.match(appSource, /<Sheet open=\{sheetOpen\} onOpenChange=\{handleSheetOpenChange\}>/);
  assert.match(appSource, /<SheetContent side="left" className="flex flex-col w-\[min\(20rem,85vw\)\] p-4" onCloseAutoFocus=\{handleSheetCloseAutoFocus\}>/);

  const desktopNavigation = '<SidebarContent context={context} onLogout={handleLogoutClick} onNavigate={navigate} sitesActive={sitesActive} />';
  const mobileNavigation = '<SidebarContent context={context} onLogout={handleLogoutClick} onNavigate={navigateFromSheet} sitesActive={sitesActive} />';
  assert.equal(appSource.split(desktopNavigation).length - 1, 1);
  assert.equal(appSource.split(mobileNavigation).length - 1, 1);
  assert.match(appSource, /<ConsoleRouteView route=\{route\} onNavigate=\{navigate\} \/>/);
  assert.doesNotMatch(appSource, /\bsetTimeout\b|\brequestAnimationFrame\b/);
});

test('Alert primitive ref types match rendered elements', async () => {
  const alertSource = await readFile(new URL('../src/components/ui/alert.tsx', import.meta.url), 'utf8');
  assert.match(alertSource, /forwardRef<HTMLHeadingElement/);
  assert.match(alertSource, /<h5\b/);
  assert.match(alertSource, /forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>/);
});
