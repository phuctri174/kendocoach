/**
 * Fictional opponent dojo names. Deliberately invented poetic names rather
 * than anything resembling a real Vietnamese kendo club.
 */
export const OPPONENT_CLUB_NAMES = [
  "Dojo Bạch Tùng",
  "Dojo Hắc Trúc",
  "Dojo Vân Kiếm",
  "Dojo Thiết Mộc",
  "Dojo Long Tuyền",
  "Dojo Phong Lâm",
  "Dojo Thanh Vũ",
  "Dojo Kim Sơn",
  "Dojo Nguyệt Ảnh",
  "Dojo Tuyết Đao",
  "Dojo Huyền Vũ",
  "Dojo Xích Diệp",
];

/** Picks a distinct club name per round from a shuffled-by-seed order. */
export function opponentNameFor(roundIndex: number, offset: number): string {
  const i = (roundIndex * 3 + offset) % OPPONENT_CLUB_NAMES.length;
  return OPPONENT_CLUB_NAMES[i];
}
