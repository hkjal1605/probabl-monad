"use client";

import { createContext, type ReactNode, use } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { usePhone } from "@/hooks/usePhone";
import { cn } from "@/lib/utils";

/** A dialog that is a centred card on a wide screen and a bottom sheet on a phone, where a
 * centred card sits under the thumb's reach and, with a field, under the keyboard. Its parts
 * take the same props either way; open it from state (`open`). */
const Sheet = createContext(false);

function ResponsiveDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const phone = usePhone();
  const change = (next: boolean) => onOpenChange(next);
  return (
    <Sheet value={phone}>
      {phone ? (
        <Drawer open={open} onOpenChange={change}>
          {children}
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={change}>
          {children}
        </Dialog>
      )}
    </Sheet>
  );
}

/** The dialog's box: `className` lays out the centred card; in a sheet, `sheetClassName` lays
 * out the body under the header (the header stays put, the body scrolls unless `scroll` is
 * false). */
function ResponsiveDialogContent({
  className,
  sheetClassName,
  header,
  children,
  size = "auto",
  keyboard = false,
  scroll = true,
}: {
  className?: string;
  sheetClassName?: string;
  /** The title (and what goes with it), fixed above the body in a sheet. */
  header: ReactNode;
  children: ReactNode;
  size?: "auto" | "tall";
  keyboard?: boolean;
  scroll?: boolean;
}) {
  if (!use(Sheet))
    return (
      <DialogContent className={className}>
        {header}
        {children}
      </DialogContent>
    );
  return (
    <DrawerContent size={size} keyboard={keyboard}>
      {header}
      <DrawerBody scroll={scroll} className={cn("gap-3", sheetClassName)}>
        {children}
      </DrawerBody>
    </DrawerContent>
  );
}

function ResponsiveDialogHeader({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return use(Sheet) ? (
    <DrawerHeader className={className}>{children}</DrawerHeader>
  ) : (
    <DialogHeader className={className}>{children}</DialogHeader>
  );
}

function ResponsiveDialogTitle({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return use(Sheet) ? (
    <DrawerTitle className={className}>{children}</DrawerTitle>
  ) : (
    <DialogTitle className={className}>{children}</DialogTitle>
  );
}

function ResponsiveDialogDescription({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return use(Sheet) ? (
    <DrawerDescription className={className}>{children}</DrawerDescription>
  ) : (
    <DialogDescription className={className}>{children}</DialogDescription>
  );
}

export {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
};
