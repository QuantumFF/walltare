import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A destination with nothing in it: an icon, one sentence saying why, and the
 * control that leads out.
 *
 * One component for every such state rather than a block per view, because
 * ADR 0015's rule is about the pair and not about either half — no tab is ever
 * disabled, so every destination owes a sentence saying why it is empty *and*
 * where to go instead, and two independently written blocks are how one of them
 * ends up with the sentence and no route.
 *
 * It lives here rather than in the library page because Review had written its
 * own: the same icon-sentence-route shape at a different icon size, a different
 * muting and a different gap, which is the drift this shape exists to prevent.
 * What differs between the three states is the wording and where the control
 * leads, which is the whole of what this takes.
 *
 * `h-full` and `flex-1` are both here because the two hosts hand it different
 * boxes — the library page's scroll container is a block and Review's column is
 * a flex — and the state should sit in the middle of whichever it is given.
 */
export function EmptyState({
  icon: Icon,
  action,
  onAction,
  children,
}: {
  icon: LucideIcon;
  action: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <Icon className="h-10 w-10 text-muted-foreground/30" aria-hidden />
      <p className="text-sm text-muted-foreground">{children}</p>
      <Button variant="link" onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}
