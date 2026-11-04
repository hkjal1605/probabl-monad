"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "@/lib/utils";

/** One thumb on a track: the filled part runs from the start to the value. */
function Slider({ className, ...props }: SliderPrimitive.Root.Props) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative flex w-full touch-none items-center select-none", className)}
      {...props}
    >
      <SliderPrimitive.Control className="flex h-6 w-full items-center">
        <SliderPrimitive.Track className="relative h-1.5 w-full grow rounded-full bg-secondary">
          <SliderPrimitive.Indicator className="absolute h-full rounded-full bg-primary" />
          <SliderPrimitive.Thumb className="block size-5 rounded-full border-2 border-primary bg-background shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
