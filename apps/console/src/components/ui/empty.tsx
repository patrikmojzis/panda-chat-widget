import { type HTMLAttributes, type ReactNode, forwardRef } from 'react';

import { cn } from '@/lib/utils';

const Empty = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="empty"
    className={cn("flex min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card p-8 text-center text-balance", className)}
    {...props}
  />
));
Empty.displayName = 'Empty';

function EmptyTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-medium tracking-tight", className)} {...props} />;
}

function EmptyDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("max-w-md text-sm leading-6 text-muted-foreground", className)} {...props} />;
}

function EmptyAction({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export { Empty, EmptyAction, EmptyDescription, EmptyTitle };
