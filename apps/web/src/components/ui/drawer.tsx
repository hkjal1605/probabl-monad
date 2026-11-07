"use client";

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { XIcon } from "lucide-react";
import type * as React from "react";
import { createContext, use } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A bottom sheet: it rises from the bottom edge over a dimmed page, follows the finger and
 * closes when swiped down, its header and footer fixed and its body scrolling. The phone form of
 * the app's popovers and dialogs (see `responsive-popover` and `responsive-dialog`). */
function Drawer(props: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger(props: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerClose(props: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

/** Whether a part is rendered in a bottom sheet, for content that lays itself out for one (a
 * list that fills it, larger targets, no field focused on opening). */
const InSheet = createContext(false);
export const useInSheet = () => use(InSheet);

/** The motion every sheet shares: iOS's sheet curve, quicker when flung. */
const MOTION =
  "transition-[transform,opacity] duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] motion-reduce:transition-none";

function DrawerContent({
  className,
  children,
  size = "auto",
  keyboard = false,
  showCloseButton = true,
  ...props
}: DrawerPrimitive.Popup.Props & {
  /** `auto` fits its content; `tall` takes most of the screen whatever is in it (a search: its
   * results come and go without the sheet changing height). */
  size?: "auto" | "tall";
  /** It has a field to type in: the software keyboard is followed (`--drawer-keyboard-inset`). */
  keyboard?: boolean;
  showCloseButton?: boolean;
}) {
  const sheet = (
    <DrawerPrimitive.Portal data-slot="drawer-portal">
      <DrawerPrimitive.Backdrop
        data-slot="drawer-overlay"
        className={cn(
          "fixed inset-0 z-50 min-h-dvh bg-overlay [--backdrop-opacity:0.4] opacity-[calc(var(--backdrop-opacity)*(1-var(--drawer-swipe-progress)))] data-starting-style:opacity-0 data-ending-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute dark:[--backdrop-opacity:0.72]",
          MOTION,
        )}
      />
      <DrawerPrimitive.Viewport
        data-slot="drawer-viewport"
        className="fixed inset-0 z-50 flex touch-none items-end justify-center [--bleed:3rem]"
      >
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            // It reaches `--bleed` below the screen, so pulling it up past its height shows more
            // of the sheet, never the page; the safe area keeps its last line above the home bar.
            "relative -mb-(--bleed) flex w-full max-w-xl touch-none flex-col rounded-t-[1.75rem] bg-popover pb-[calc(var(--bleed)+env(safe-area-inset-bottom,0px))] text-sm text-popover-foreground shadow-[0_-12px_48px_-12px_rgb(0_0_0/0.45)] ring-1 ring-border outline-none will-change-transform [transform:translateY(var(--drawer-swipe-movement-y))] data-swiping:select-none data-starting-style:[transform:translateY(calc(100%_-_var(--bleed)_+_2px))] data-ending-style:[transform:translateY(calc(100%_-_var(--bleed)_+_2px))] dark:bg-card",
            size === "tall"
              ? "h-[calc(88dvh+var(--bleed))]"
              : "max-h-[calc(100dvh-2.5rem+var(--bleed))]",
            MOTION,
            className,
          )}
          {...props}
        >
          <div aria-hidden className="flex shrink-0 justify-center pt-2.5 pb-1.5">
            <span className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <InSheet value={true}>{children}</InSheet>
          {showCloseButton && (
            <DrawerPrimitive.Close
              data-slot="drawer-close"
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-[18px] right-3 rounded-full text-muted-foreground"
                />
              }
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DrawerPrimitive.Close>
          )}
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  );
  return keyboard ? (
    <DrawerPrimitive.VirtualKeyboardProvider>{sheet}</DrawerPrimitive.VirtualKeyboardProvider>
  ) : (
    sheet
  );
}

/** The sheet's title row (and anything under it), clear of the close button. */
function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex shrink-0 touch-none flex-col gap-1 px-5 pt-1 pr-14 pb-3", className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-base leading-6 font-medium text-foreground", className)}
      {...props}
    />
  );
}

function DrawerDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/** The part that scrolls (or, with `scroll={false}`, holds a part that scrolls itself, such as
 * a list under a search field). */
function DrawerBody({
  className,
  scroll = true,
  ...props
}: DrawerPrimitive.Content.Props & { scroll?: boolean }) {
  return (
    <DrawerPrimitive.Content
      data-slot="drawer-body"
      className={cn(
        "flex min-h-0 flex-1 flex-col px-5 pb-4",
        scroll ? "touch-auto overflow-y-auto overscroll-contain" : "overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("flex shrink-0 flex-col gap-2 px-5 pt-1 pb-3", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
};
