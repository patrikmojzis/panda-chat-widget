import { type HTMLAttributes, type ReactNode, forwardRef } from 'react';

import { cn } from '@/lib/utils';

const Empty = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col items-start gap-3 rounded-xl border border-dashed bg-card p-6", className)}
    {...props}
  />
));
Empty.displayName = 'Empty';

function EmptyTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold", className)} {...props} />;
}

function EmptyDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function EmptyAction({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export { Empty, EmptyAction, EmptyDescription, EmptyTitle };
