import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, Menu, Plus, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ConsoleNavigation, PageHeader } from './console-presentation';
import './index.css';

const previewContext = {
  user: { id: 'preview-user', email: 'owner@example.com' },
  workspace: { id: 'preview-workspace', name: 'Acme Support' },
};

function PreviewShell() {
  const showSettings = new URLSearchParams(window.location.search).has('settings');

  return (
    <div className="grid min-h-dvh min-w-0 bg-background md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh min-w-0 flex-col border-r bg-sidebar p-3 md:flex" aria-label="Console navigation">
        <ConsoleNavigation context={previewContext} onLogout={() => {}} onNavigate={() => {}} sitesActive />
      </aside>
      <main className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-40 flex h-16 min-w-0 items-center gap-3 bg-background/95 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation menu"><Menu className="size-5" /></Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">Acme Support</p>
            <span className="block truncate text-xs text-muted-foreground md:hidden">Widget console</span>
          </div>
          <span className="hidden text-xs text-muted-foreground sm:block">owner@example.com</span>
          <div className="pointer-events-none absolute inset-x-0 -bottom-2 h-2 bg-gradient-to-b from-background to-transparent" />
        </header>
        <div className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6 lg:p-8">
          {showSettings ? <SettingsPreview /> : <SitesPreview />}
        </div>
      </main>
    </div>
  );
}

function SitesPreview() {
  return (
    <section className="grid min-w-0 w-full gap-6" aria-labelledby="preview-sites-title">
      <PageHeader
        eyebrow="Workspace"
        title="Sites"
        body="Create a site for each web property that will use a chat widget."
        action={<Button variant="outline"><Plus className="size-4" />New site</Button>}
        titleId="preview-sites-title"
      />
      <Card className="overflow-hidden shadow-none">
        <Table aria-label="Workspace sites">
          <TableHeader><TableRow><TableHead className="w-[34%]">Name</TableHead><TableHead>Status</TableHead><TableHead className="hidden md:table-cell">Created</TableHead><TableHead className="hidden lg:table-cell">Updated</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {['Marketing website', 'Documentation'].map((name, index) => (
              <TableRow key={name}>
                <TableCell className="whitespace-normal font-medium">{name}</TableCell>
                <TableCell><Badge variant="secondary">Enabled</Badge></TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">Jul 23, 2026</TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">Jul {23 - index}, 2026</TableCell>
                <TableCell className="text-right"><Button variant="ghost" size="sm">Open <ArrowRight className="size-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}

function SettingsPreview() {
  return (
    <section className="grid min-w-0 w-full gap-6" aria-labelledby="preview-widget-title">
      <PageHeader
        eyebrow="Widget settings"
        title="Support assistant"
        body="Manage the assistant copy, allowed domains, connection, and install snippet."
        action={<Button variant="ghost"><ArrowLeft className="size-4" />Back to site</Button>}
        titleId="preview-widget-title"
      />
      <div className="flex min-w-0 flex-col gap-2 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium">Public key</p><p className="text-xs text-muted-foreground">Safe to publish through the loader on allowed domains.</p></div>
        <code className="min-w-0 rounded-md bg-background px-2.5 py-1.5 text-xs ring-1 ring-border">pk_widget_7f12ac90</code>
      </div>
      <Tabs className="min-w-0" defaultValue="copy">
        <TabsList variant="line" className="h-auto w-full max-w-full justify-start overflow-x-auto border-b">
          <TabsTrigger className="flex-none px-3" value="copy">Design</TabsTrigger>
          <TabsTrigger className="flex-none px-3" value="connection">Connection</TabsTrigger>
          <TabsTrigger className="flex-none px-3" value="domains">Domains</TabsTrigger>
          <TabsTrigger className="flex-none px-3" value="install">Install</TabsTrigger>
        </TabsList>
        <TabsContent className="pt-4" value="copy">
          <Card className="shadow-none">
            <CardHeader className="space-y-2"><h3 className="font-semibold leading-none tracking-tight">Appearance and welcome copy</h3><CardDescription>Customize the safe text and theme tokens shown to visitors.</CardDescription></CardHeader>
            <CardContent className="grid gap-4">
              <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
                <Field><FieldLabel>Widget name</FieldLabel><Input defaultValue="Support assistant" /></Field>
                <Field><FieldLabel>Assistant display name</FieldLabel><Input defaultValue="Panda Assistant" /></Field>
                <Field><FieldLabel>Launcher label</FieldLabel><Input defaultValue="Open chat" /></Field>
                <Field><FieldLabel>Theme color mode</FieldLabel><Select defaultValue="system"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">System</SelectItem></SelectContent></Select><FieldDescription>Follow the visitor device theme.</FieldDescription></Field>
                <Field className="sm:col-span-2"><FieldLabel>Welcome title</FieldLabel><Input defaultValue="How can I help?" /></Field>
                <Field className="sm:col-span-2"><FieldLabel>Welcome subtitle</FieldLabel><Textarea defaultValue="Ask me anything or describe what you need help with." /></Field>
              </FieldGroup>
              <Button className="w-fit">Save settings</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </section>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Console preview root not found');
createRoot(rootElement).render(<StrictMode><PreviewShell /></StrictMode>);
