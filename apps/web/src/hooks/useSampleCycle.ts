import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/** How the worlds page's open events change their samples: every slot at once, resting long
 * enough to read, then a soft dissolve. The old events blur up and away, the new ones rise in
 * word by word, and the words after them glide along their line to their new places (or, when
 * they move to another line, dissolve and rise in with the new events).
 *
 * Every set of samples is also laid out unseen (`ghosts`: one per set, stacked in the live
 * sentence's grid cell), so the cell is always the tallest set's height and never changes as
 * the samples do, and where each part lands next is known before the change starts. The parts
 * that can move are marked `data-atom`; an open event is `data-atom="slot-…"` with the shown
 * sample's id in `data-sample`, its words `data-word`.
 *
 * Still while the reader asked for less motion, while the tab is hidden, while the pointer is
 * on an open event (it's being aimed at) and while any of the sentence's popovers is open. */

const HOLD_MS = 6_500;
const RETRY_MS = 1_000;
const OUT_MS = 380;
const IN_MS = 720;
const CHIP_IN_MS = 520;
const GLIDE_MS = 820;
const STAGGER_MS = 42;
const SPREAD_MS = 320;
const EASE_IN = "cubic-bezier(0.32, 0, 0.67, 0)";
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

const LEAVE: Keyframe[] = [
  { opacity: 1, top: "0em", filter: "blur(0px)" },
  { opacity: 0, top: "-0.14em", filter: "blur(6px)" },
];
const BLUR_UP: Keyframe[] = [
  { top: "0em", filter: "blur(0px)" },
  { top: "-0.14em", filter: "blur(6px)" },
];
const RISE: Keyframe[] = [
  { opacity: 0, top: "0.32em", filter: "blur(8px)" },
  { opacity: 1, top: "0em", filter: "blur(0px)" },
];

export function useSampleCycle({
  count,
  live,
  ghosts,
  epoch,
  ready,
}: {
  /** Sets of samples the open events step through together. */
  count: number;
  /** The sentence the reader sees. */
  live: RefObject<HTMLElement | null>;
  /** The same sentence laid out for each set, unseen. */
  ghosts: RefObject<(HTMLElement | null)[]>;
  /** Changes whenever anything but the samples' turn changes the sentence (it starts the rest
   * over and stops a change under way). */
  epoch: string;
  /** Whether the live sentence is on the page (its first samples rise in once it is). */
  ready: boolean;
}) {
  const [step, setStep] = useState(0);
  const at = useRef(0);
  const aiming = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new epoch starts the rest over.
  useEffect(() => {
    if (count < 2 || quiet()) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const motion = new Motion();
    const tick = async () => {
      const root = live.current;
      const next = (at.current + 1) % count;
      const ahead = ghosts.current?.[next];
      if (!root || !ahead) {
        timer = setTimeout(tick, HOLD_MS);
        return;
      }
      if (document.hidden || aiming.current || root.querySelector("[data-popup-open]")) {
        timer = setTimeout(tick, RETRY_MS);
        return;
      }
      await turn(
        root,
        ahead,
        motion,
        () => alive,
        () => {
          at.current = next;
          flushSync(() => setStep(next));
        },
      );
      if (alive) timer = setTimeout(tick, HOLD_MS);
    };
    timer = setTimeout(tick, HOLD_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
      motion.stop();
    };
  }, [count, epoch, live, ghosts]);

  // The first samples rise in when the sentence shows them.
  const entered = useRef(false);
  useLayoutEffect(() => {
    if (entered.current || !ready || count === 0) return;
    entered.current = true;
    const root = live.current;
    if (!root || quiet()) return;
    const motion = new Motion();
    const slots = [...root.querySelectorAll<HTMLElement>('[data-atom^="slot-"]')];
    rise(motion, slots, slots.flatMap(words));
    void motion.settled().then(() => motion.stop());
  }, [ready, count, live]);

  return {
    step: count ? step % count : 0,
    /** On the live sentence: an open event under the pointer keeps its sample. */
    aim: {
      onPointerOver: (e: { target: EventTarget; pointerType: string }) => {
        aiming.current =
          e.pointerType === "mouse" &&
          e.target instanceof Element &&
          e.target.closest('[data-atom^="slot-"]') !== null;
      },
      onPointerLeave: () => {
        aiming.current = false;
      },
    },
  };
}

const FADE_OUT: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];
const FADE_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

/** One change of samples, from what `root` shows to what `ahead` lays out; `swap` renders it. */
async function turn(
  root: HTMLElement,
  ahead: HTMLElement,
  motion: Motion,
  alive: () => boolean,
  swap: () => void,
) {
  const here = root.getBoundingClientRect();
  const there = ahead.getBoundingClientRect();
  const now = parts(root);
  const next = parts(ahead);
  // The open events that change, and where their new samples will be.
  const changing: HTMLElement[] = [];
  const landing: Box[] = [];
  for (const [key, el] of now) {
    const later = next.get(key);
    if (key.startsWith("slot-") && el.dataset.sample !== later?.dataset.sample) {
      changing.push(el);
      if (later) landing.push(...boxes(later, there));
    }
  }
  // The rest stay, glide along their line, or (moving to another line, or gliding through where
  // a new sample lands) leave and rise in with the new samples.
  const leaving: HTMLElement[] = [];
  const before = new Map<HTMLElement, Box[]>();
  for (const [key, el] of now) {
    if (changing.includes(el)) continue;
    const then = boxes(el, here);
    before.set(el, then);
    const later = next.get(key);
    const after = later ? boxes(later, there) : [];
    const dx = along(then, after);
    if (dx === null || (!near(dx, 0) && crosses(then, after, landing))) leaving.push(el);
  }
  if (changing.length === 0) {
    swap();
    return;
  }

  const outs = [
    ...changing.map((el) =>
      motion.play(el, FADE_OUT, { duration: OUT_MS, easing: EASE_IN, fill: "forwards" }),
    ),
    ...changing
      .flatMap(words)
      .map((el) =>
        motion.play(el, BLUR_UP, { duration: OUT_MS, easing: EASE_IN, fill: "forwards" }),
      ),
    ...leaving.map((el) =>
      motion.play(el, LEAVE, { duration: OUT_MS, easing: EASE_IN, fill: "forwards" }),
    ),
  ];
  await Promise.allSettled(outs.map((a) => a.finished));
  if (!alive()) return;

  swap();
  const origin = root.getBoundingClientRect();
  const arriving = [...leaving];
  for (const [el, then] of before) {
    if (leaving.includes(el) || !el.isConnected) continue;
    const dx = along(then, boxes(el, origin));
    // Moved where the unseen layout didn't say: rise in with the new events, never jump.
    if (dx === null) arriving.push(el);
    else if (!near(dx, 0))
      motion.play(el, [{ left: `${-dx}px` }, { left: "0px" }], {
        duration: GLIDE_MS,
        easing: EASE_OUT,
      });
  }
  rise(motion, changing, [...changing.flatMap(words), ...arriving]);
  // The ins start where the outs left off, so the outs' held ends can go.
  for (const a of outs) a.cancel();
  await motion.settled();
  if (alive()) motion.stop();
}

/** The new words and moved parts rise in, one after another in reading order; each open
 * event's chip fades in under its first word as that word starts to rise. */
function rise(motion: Motion, chips: HTMLElement[], els: HTMLElement[]) {
  els.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const gap = els.length > 1 ? Math.min(STAGGER_MS, SPREAD_MS / (els.length - 1)) : 0;
  els.forEach((el, i) => {
    motion.play(el, RISE, {
      duration: IN_MS,
      delay: i * gap,
      easing: EASE_OUT,
      fill: "backwards",
    });
  });
  for (const chip of chips) {
    const first = els.findIndex((el) => chip.contains(el));
    motion.play(chip, FADE_IN, {
      duration: CHIP_IN_MS,
      delay: Math.max(first, 0) * gap,
      easing: EASE_OUT,
      fill: "backwards",
    });
  }
}

const parts = (root: Element) => {
  const out = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-atom]"))
    out.set(el.dataset.atom ?? "", el);
  return out;
};

const words = (el: Element) => [...el.querySelectorAll<HTMLElement>("[data-word]")];

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** An element's line boxes (one per line it's on), from the sentence's corner. */
const boxes = (el: Element, origin: DOMRect): Box[] =>
  Array.from(el.getClientRects(), (r) => ({
    left: r.left - origin.left,
    top: r.top - origin.top,
    width: r.width,
    height: r.height,
  }));

const near = (a: number, b: number) => Math.abs(a - b) < 0.75;

/** How far `after` is `before` moved along its lines (the same lines, the same widths): the
 * shift in pixels, or null when it moved to another line or changed shape. */
function along(before: Box[], after: Box[]): number | null {
  const first = before[0];
  const moved = after[0];
  if (!first || !moved || before.length !== after.length) return null;
  const dx = moved.left - first.left;
  const kept = before.every((b, i) => {
    const a = after[i];
    return (
      a !== undefined && near(a.top, b.top) && near(a.width, b.width) && near(a.left - b.left, dx)
    );
  });
  return kept ? dx : null;
}

/** Whether a part gliding from `before` to `after` would pass over any of `boxes` on its line. */
function crosses(before: Box[], after: Box[], boxes: Box[]) {
  return after.some((a, i) => {
    const b = before[i] ?? a;
    const from = Math.min(a.left, b.left);
    const to = Math.max(a.left + a.width, b.left + b.width);
    return boxes.some(
      (x) =>
        x.top < a.top + a.height - 1 &&
        a.top < x.top + x.height - 1 &&
        x.left < to - 1 &&
        from < x.left + x.width - 1,
    );
  });
}

const quiet = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** The animations of one change, and the offsets they need (`top` and `left` move an inline
 * part only when it's positioned), undone together. */
class Motion {
  private readonly playing: Animation[] = [];
  private readonly lifted: HTMLElement[] = [];

  play(el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    if (getComputedStyle(el).position === "static") {
      el.style.position = "relative";
      this.lifted.push(el);
    }
    const a = el.animate(frames, options);
    this.playing.push(a);
    return a;
  }

  /** Once every animation still to play has ended. (A cancelled one has: its `finished` is then
   * a new promise, settled only if it plays again.) */
  async settled() {
    await Promise.allSettled(
      this.playing.filter((a) => a.playState !== "idle").map((a) => a.finished),
    );
  }

  stop() {
    for (const a of this.playing.splice(0)) a.cancel();
    for (const el of this.lifted.splice(0)) el.style.position = "";
  }
}
