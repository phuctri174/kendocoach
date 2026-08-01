import type { Metadata } from "next";
import { DoiKhangHome } from "@/components/versus/DoiKhangHome";

export const metadata: Metadata = {
  title: "Đấu đối kháng — Đà Lạt Kendo Club",
  description: "Phòng chờ Bo5 đối kháng trực tuyến giữa hai người chơi thật.",
};

export default function Home() {
  return <DoiKhangHome />;
}
