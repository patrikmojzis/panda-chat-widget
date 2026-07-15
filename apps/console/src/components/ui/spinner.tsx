import { Loader2 } from 'lucide-react';
import { type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

function Spinner({ className, ...props }: HTMLAttributes<SVGSVGElement>) {
  return (
    <Loader2
      className={cn("size-4 animate-spin", className)}
      aria-label="Loading"
      role="status"
      {...props}
    />
  );
}

export { Spinner };
