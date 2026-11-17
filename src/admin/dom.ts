export type Child = Node | string | number | null | undefined | false;

/** Attributes rather than properties (no matching DOM property, or a string form is wanted). */
const ATTRIBUTES = new Set(["style", "list", "download", "colSpan"]);

/** `document.createElement` with properties and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, unknown>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (ATTRIBUTES.has(key)) element.setAttribute(key, String(value));
    else (element as unknown as Record<string, unknown>)[key] = value;
  }
  for (const child of children)
    if (child !== null && child !== undefined && child !== false && child !== "")
      element.append(typeof child === "number" ? String(child) : child);
  return element;
}

export const node = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export const number = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

export const dateTime = (time: number | null | undefined): string =>
  time ? new Date(time).toLocaleString("vi-VN", { timeZone: "Asia/Bangkok" }) : "—";

export const money = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : number.format(value);

export function playTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const minutes = Math.floor(ms / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút` : `${minutes} phút`;
}
