import { cn } from '@/lib/utils'

/**
 * Board — the dashboard layout mode for data.
 *
 * The problem it solves: every list in this app is `flex justify-between` with
 * text on the left and chips pinned right. Measured across Today's rows at
 * 1182px, the MEDIAN row carried 873px of dead space in the middle — 74% of its
 * own width. Widening the page widens that hole. Rows do not want more width;
 * they want ~520px, and the only way to spend a 2560px monitor on ~520px rows
 * is columns.
 *
 * So Board is a column flow, not a stack. Cards fall into 520px-ish columns and
 * the page gets shorter as the window gets wider, instead of longer.
 *
 * CSS multi-column rather than grid: card heights here are content-driven and
 * wildly uneven (a 3-row card beside a 20-row queue), and columns pack that
 * unevenness without the row-locking a grid imposes.
 */
export function Board({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        // columns-* sets a MINIMUM column width; the browser fits as many as the
        // window allows. One column below lg keeps phones untouched.
        'gap-4 lg:columns-[32rem] lg:[column-fill:balance] 3xl:columns-[34rem]',
        '[&>*]:mb-4 [&>*]:break-inside-avoid lg:[&>*]:inline-block lg:[&>*]:w-full',
        className,
      )}
    >
      {children}
    </div>
  )
}
