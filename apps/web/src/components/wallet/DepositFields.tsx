"use client";
/** The parts both deposit dialogs share: a token's icon and the amount field (what the wallet
 * holds, Max, the amount and why it can't be deposited). */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

export function TokenIcon({
  symbol,
  image,
}: {
  symbol: string;
  image?: string | null | undefined;
}) {
  return (
    <Avatar size="sm">
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback>{symbol.slice(0, 2)}</AvatarFallback>
    </Avatar>
  );
}

export function DepositAmountField({
  id,
  symbol,
  available,
  amount,
  onAmount,
  error,
  onMax,
  maxDisabled,
}: {
  id: string;
  symbol: string | undefined;
  /** What the wallet holds, written out ("1.2K USDG"); null while unknown. */
  available: string | null;
  amount: string;
  onAmount: (amount: string) => void;
  error: string | null;
  onMax: () => void;
  maxDisabled: boolean;
}) {
  return (
    <Field data-invalid={Boolean(error)}>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor={id}>Amount</FieldLabel>
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            Available {available ?? "—"}
          </span>
          <Button type="button" variant="link" size="sm" disabled={maxDisabled} onClick={onMax}>
            Max
          </Button>
        </div>
      </div>
      <InputGroup className="h-14 rounded-xl border-0 bg-secondary">
        <InputGroupInput
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={amount}
          aria-invalid={Boolean(error)}
          className="text-xl font-medium tabular-nums md:text-xl"
          onChange={(event) => onAmount(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{symbol}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}
