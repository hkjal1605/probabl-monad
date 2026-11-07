"use client";

import { createContext, type ReactElement, type ReactNode, use } from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { usePhone } from "@/hooks/usePhone";
import { cn } from "@/lib/utils";

/** A picker that opens where it's asked for: a popover under its trigger on a wide screen, a
 * bottom sheet on a phone (a popover there lands over what it edits, half under the keyboard).
 * Its parts take the same props either way. */
const Sheet = createContext(false);

function ResponsivePopover({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const phone = usePhone();
  const state = {
    ...(open !== undefined ? { open } : {}),
    ...(onOpenChange ? { onOpenChange: (next: boolean) => onOpenChange(next) } : {}),
  };
  return (
    <Sheet value={phone}>
      {phone ? <Drawer {...state}>{children}</Drawer> : <Popover {...state}>{children}</Popover>}
    </Sheet>
  );
}

type TriggerProps = {
  render?: ReactElement;
  nativeButton?: boolean;
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
} & Record<`data-${string}` | `aria-${string}`, string | number | boolean | undefined>;

function ResponsivePopoverTrigger(props: TriggerProps) {
  return use(Sheet) ? <DrawerTrigger {...props} /> : <PopoverTrigger {...props} />;
}

function ResponsivePopoverContent({
  title,
  showTitle = false,
  className,
  sheetClassName,
  children,
  size = "auto",
  keyboard = false,
  scroll = true,
  done = false,
  align,
  side,
}: {
  /** What it picks ("Choose an event"): the sheet's heading, the popover's accessible name. */
  title: ReactNode;
  /** Show the title in the popover too (a sheet always shows it). */
  showTitle?: boolean;
  /** The popover's box (its width, its layout). */
  className?: string;
  /** The sheet's body (its layout; it fills the sheet's width). */
  sheetClassName?: string;
  children: ReactNode;
  size?: "auto" | "tall";
  keyboard?: boolean;
  /** Whether the sheet's body scrolls (else a part of it does, such as a list). */
  scroll?: boolean;
  /** A "Done" button closes the sheet (for an editor that changes as you go). */
  done?: boolean;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}) {
  if (!use(Sheet))
    return (
      <PopoverContent
        className={className}
        {...(align ? { align } : {})}
        {...(side ? { side } : {})}
      >
        <PopoverTitle className={showTitle ? "leading-5" : "sr-only"}>{title}</PopoverTitle>
        {children}
      </PopoverContent>
    );
  return (
    <DrawerContent size={size} keyboard={keyboard}>
      <DrawerHeader>
        <DrawerTitle>{title}</DrawerTitle>
      </DrawerHeader>
      <DrawerBody scroll={scroll} className={cn("gap-3", sheetClassName)}>
        {children}
      </DrawerBody>
      {done && (
        <DrawerFooter>
          <DrawerClose render={<Button size="lg" className="h-11 w-full text-base" />}>
            Done
          </DrawerClose>
        </DrawerFooter>
      )}
    </DrawerContent>
  );
}

export { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger };
