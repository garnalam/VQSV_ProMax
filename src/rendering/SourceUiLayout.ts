export type SourceUiWidget = {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  bandHeight?: number;
  b: number;
  text?: string;
  imageId?: number;
  e_color?: number;
  f_color?: number;
  g_color?: number;
  j_color?: number;
  k_color?: number;
  l_color?: number;
  eColor?: number;
  fColor?: number;
  gColor?: number;
  jColor?: number;
  kColor?: number;
  lColor?: number;
  altId?: number;
  altMode?: number;
  alt_image_ref?: { id: number; mode: number } | null;
};
type SourceNode = { type?: string; children?: SourceNode[]; [key: string]: unknown };
export class SourceUiLayout {
  private readonly widgets = new Map<number, SourceUiWidget>();
  constructor(source: { root?: SourceNode; widgets?: Record<string, SourceUiWidget> }) {
    if (source.widgets)
      for (const widget of Object.values(source.widgets)) this.widgets.set(widget.id, widget);
    else if (source.root) this.collect(source.root);
  }
  widget(id: number): SourceUiWidget | undefined {
    return this.widgets.get(id);
  }
  /** Every widget, for a layout derived from this one (`WorldShopDonateMenu`). */
  all(): SourceUiWidget[] {
    return [...this.widgets.values()];
  }
  /** `VqsvUiLayout.text(id, fallback)`: the binary `.ui` label when the widget carries one. */
  text(id: number, fallback: string): string {
    const widget = this.widgets.get(id);
    return !widget || !widget.text ? fallback : widget.text;
  }
  /** `VqsvUiLayout.x` / `y`: the widget's position, or the caller's code position without one. */
  x(id: number, fallback: number): number {
    return this.widgets.get(id)?.x ?? fallback;
  }
  y(id: number, fallback: number): number {
    return this.widgets.get(id)?.y ?? fallback;
  }
  w(id: number, fallback: number): number {
    const widget = this.widgets.get(id);
    return !widget || widget.w <= 0 ? fallback : widget.w;
  }
  h(id: number, fallback: number): number {
    const widget = this.widgets.get(id);
    return !widget || widget.h <= 0 ? fallback : widget.h;
  }
  /** Java derives a zero-height band's extent from the next widget that shares its column and width. */
  bandHeight(id: number, fallback: number): number {
    const widget = this.widgets.get(id);
    if (!widget) return fallback;
    if (widget.h > 0) return widget.h;
    let nextY = Number.POSITIVE_INFINITY;
    for (const other of this.widgets.values()) {
      if (other.id === widget.id || other.y <= widget.y) continue;
      if (other.x === widget.x && Math.abs(other.w - widget.w) <= 1)
        nextY = Math.min(nextY, other.y);
    }
    return Number.isFinite(nextY) ? Math.max(1, nextY - widget.y) : fallback;
  }
  private collect(node: SourceNode): void {
    if (node.type === "visual" && typeof node.id === "number")
      this.widgets.set(node.id, node as SourceUiWidget);
    for (const child of node.children ?? []) this.collect(child);
  }
}
