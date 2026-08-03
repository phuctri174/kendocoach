export type MatchFormat = "bo3" | "bo5";

export interface RoomRow {
  id: number;
  occupant_a: string | null;
  occupant_b: string | null;
  ready_a: boolean;
  ready_b: boolean;
  status: "open" | "full" | "in_match";
  /** Fixed per room, not chosen per-match — rooms 1-3 are Bo5, 4-6 are Bo3. */
  format: MatchFormat;
  updated_at: string;
}

export function isValidRoomId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}
