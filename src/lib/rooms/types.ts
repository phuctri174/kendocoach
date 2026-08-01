export interface RoomRow {
  id: number;
  occupant_a: string | null;
  occupant_b: string | null;
  ready_a: boolean;
  ready_b: boolean;
  status: "open" | "full" | "in_match";
  updated_at: string;
}

export function isValidRoomId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}
