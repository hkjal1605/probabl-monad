import type {
  AutoscaleInfo,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

export interface LevelLine {
  price: number;
  dashed: boolean;
  /** What the line is ("Avg Entry", "Buy"), on `tagColor` in `tagTextColor`. */
  tag: string;
  tagColor: string;
  tagTextColor: string;
  /** How much, on the line's `color` in `textColor`. */
  label: string;
  color: string;
  textColor: string;
}

/** Each line's length in CSS pixels, its box included (at most 45% of the pane), and the least
 * that shows beside a wider box. */
const SPAN = 180;
const MIN_LINE = 16;
const FONT_SIZE = 11;
const PAD_X = 6;
const BOX_HEIGHT = 18;

/** Short horizontal lines drawn on a series: each a box at the left end, its tag and its label on
 * either side of a divider, and a line on to the price axis, where its price shows. The series'
 * scale keeps them in view. */
export class LevelLines implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private lines: LevelLine[] = [];
  private key = "";
  private axisViews: ISeriesPrimitiveAxisView[] = [];
  private readonly renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target) };
  private readonly views: IPrimitivePaneView[] = [
    { zOrder: () => "top", renderer: () => this.renderer },
  ];

  constructor(
    private readonly font: string,
    private readonly format: (price: number) => string,
  ) {}

  attached({ series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.series = series;
    this.requestUpdate = requestUpdate;
  }

  detached() {
    this.series = null;
    this.requestUpdate = null;
  }

  /** Sets the lines; the chart redraws (and rescales) only when they changed. */
  set(lines: LevelLine[]) {
    const key = JSON.stringify(lines);
    if (key === this.key) return;
    this.key = key;
    this.lines = lines;
    this.axisViews = lines.map((line) => ({
      coordinate: () => this.series?.priceToCoordinate(line.price) ?? -1,
      visible: () => this.series?.priceToCoordinate(line.price) != null,
      text: () => this.format(line.price),
      textColor: () => line.textColor,
      backColor: () => line.color,
    }));
    this.requestUpdate?.();
  }

  autoscaleInfo(): AutoscaleInfo | null {
    if (!this.lines.length) return null;
    const prices = this.lines.map((line) => line.price);
    return { priceRange: { minValue: Math.min(...prices), maxValue: Math.max(...prices) } };
  }

  paneViews() {
    return this.views;
  }

  priceAxisViews() {
    return this.axisViews;
  }

  private draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]) {
    const series = this.series;
    if (!series || !this.lines.length) return;
    // biome-ignore lint/correctness/useHookAtTopLevel: The canvas target's drawing scope, not a React hook.
    target.useBitmapCoordinateSpace(
      ({ context, bitmapSize, horizontalPixelRatio: h, verticalPixelRatio: v }) => {
        context.save();
        context.font = `500 ${FONT_SIZE * v}px ${this.font}`;
        context.textBaseline = "middle";
        const right = bitmapSize.width;
        const span = Math.min(SPAN * h, right * 0.45);
        const width = Math.max(1, Math.floor(v));
        for (const line of this.lines) {
          const coordinate = series.priceToCoordinate(line.price);
          if (coordinate === null) continue;
          const y = Math.round(coordinate * v);
          const tag = Math.ceil(context.measureText(line.tag).width + 2 * PAD_X * h);
          const label = Math.ceil(context.measureText(line.label).width + 2 * PAD_X * h);
          const left = right - Math.max(span, tag + label + MIN_LINE * h);
          const height = Math.round(BOX_HEIGHT * v);
          const top = y - height / 2;
          const radius = 3 * h;
          context.strokeStyle = line.color;
          context.lineWidth = width;
          context.setLineDash(line.dashed ? [4 * h, 3 * h] : [h, 2 * h]);
          context.beginPath();
          context.moveTo(left + tag + label, y + (width % 2) / 2);
          context.lineTo(right, y + (width % 2) / 2);
          context.stroke();
          context.setLineDash([]);
          // The tag, the label in the line's colour beside it, and an outline whose edge between
          // them is the divider.
          context.fillStyle = line.tagColor;
          context.beginPath();
          context.roundRect(left, top, tag, height, [radius, 0, 0, radius]);
          context.fill();
          context.fillStyle = line.color;
          context.beginPath();
          context.roundRect(left + tag, top, label, height, [0, radius, radius, 0]);
          context.fill();
          context.beginPath();
          context.roundRect(
            left + width / 2,
            top + width / 2,
            tag + label - width,
            height - width,
            radius,
          );
          context.moveTo(left + tag, top);
          context.lineTo(left + tag, top + height);
          context.stroke();
          context.fillStyle = line.tagTextColor;
          context.fillText(line.tag, left + PAD_X * h, y);
          context.fillStyle = line.textColor;
          context.fillText(line.label, left + tag + PAD_X * h, y);
        }
        context.restore();
      },
    );
  }
}
