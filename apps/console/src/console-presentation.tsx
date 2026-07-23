import type { MouseEvent, ReactNode } from 'react';
import { Globe, LogOut, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { CurrentContext } from './console-api';

type ConsoleNavigationProps = {
  context: CurrentContext;
  onLogout: () => void;
  onNavigate: (path: string) => void;
  sitesActive: boolean;
};

export function ConsoleNavigation({ context, onLogout, onNavigate, sitesActive }: ConsoleNavigationProps) {
  function handleSitesClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    onNavigate('/console/sites');
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-2.5 px-2">
        <span className="inline-grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground" aria-hidden="true">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold tracking-tight">Panda Chat</p>
          <span className="block truncate text-xs text-muted-foreground">Widget console</span>
        </div>
      </div>

      <nav className="mt-7 grid gap-1" aria-label="Main navigation">
        <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Workspace</p>
        <a
          className={`flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${sitesActive ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`}
          href="/console/sites"
          aria-current={sitesActive ? 'page' : undefined}
          onClick={handleSitesClick}
        >
          <Globe className="size-4" />
          Sites &amp; widgets
        </a>
      </nav>

      <div className="mt-auto pt-4">
        <Separator className="mb-4" />
        <div className="grid min-w-0 gap-3 px-1">
          <div className="min-w-0 px-2">
            <p className="truncate text-xs font-medium">{context.workspace.name}</p>
            <span className="block truncate text-xs text-muted-foreground" title={context.user.email}>{context.user.email}</span>
          </div>
          <Button className="w-full justify-start" variant="ghost" size="sm" onClick={onLogout}>
            <LogOut className="size-4" />
            Log out
          </Button>
        </div>
      </div>
    </>
  );
}

export function PageHeader({
  action,
  body,
  eyebrow,
  title,
  titleId,
}: {
  action?: ReactNode;
  body: string;
  eyebrow: string;
  title: string;
  titleId: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>
        <h2 id={titleId} className="text-balance break-words text-2xl font-semibold leading-tight tracking-tight sm:text-3xl" tabIndex={-1}>{title}</h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}
