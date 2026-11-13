export type SourceItemDefinition = { id: number; name: string };
const ITEMS: Record<number, SourceItemDefinition> = {
  0: { id: 0, name: "Tất Trung Cầu" },
  1: { id: 1, name: "Phong ấn cầu" },
  4: { id: 4, name: "Bánh Sandwich" },
};
export const sourceItem = (id: number): SourceItemDefinition =>
  ITEMS[id] ?? { id, name: `Item ${id}` };
