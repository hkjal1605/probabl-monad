/** How a world's events are edited, wherever its sentence is shown (the worlds page, the
 * builder). The events are a list of the ones chosen, one to four:
 *
 * - removing an event takes it out of the list, and its place in the sentence with it;
 * - with none left the sentence shows one empty selector ("Select an event"), never more;
 * - "+ event" opens the search, and the event picked joins the end (or is the first).
 *
 * So a world of one event is whole, and nothing in the sentence is ever a blank waiting to be
 * filled beside events already chosen. */
import type { LegEntry, LegState } from "./types";

/** The most events a world takes. */
export const MAX_EVENTS = 4;

/** An event as first chosen: the world needs it to happen. */
export const chosenEvent = (entry: LegEntry): LegState => ({
  entry,
  wantYes: true,
  note: null,
  alternatives: [],
});

/** The events with the one at `i` changed. With none yet, the event picked in the empty
 * selector is the first. */
export const setEvent = (legs: readonly LegState[], i: number, leg: LegState): LegState[] =>
  legs.length ? legs.map((l, j) => (j === i ? leg : l)) : [leg];

/** The events without the one at `i`. */
export const removeEvent = (legs: readonly LegState[], i: number): LegState[] =>
  legs.filter((_, j) => j !== i);

/** The events with one more at the end: never the same event twice, never more than a world
 * takes. */
export const addEvent = (legs: readonly LegState[], entry: LegEntry): LegState[] =>
  legs.length >= MAX_EVENTS || legs.some((l) => l.entry.id === entry.id)
    ? [...legs]
    : [...legs, chosenEvent(entry)];
