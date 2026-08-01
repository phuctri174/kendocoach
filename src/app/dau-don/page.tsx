import type { Metadata } from "next";
import { DraftEntry } from "@/components/draft/DraftEntry";

export const metadata: Metadata = {
  title: "Đà Lạt Kendo Club — Mô phỏng huấn luyện viên",
  description:
    "Tuyển chọn đội hình từ danh sách thành viên Đà Lạt Kendo Club và dẫn dắt họ qua giải đấu loại trực tiếp 16 đội.",
};

export default function DauDonPage() {
  return <DraftEntry />;
}
