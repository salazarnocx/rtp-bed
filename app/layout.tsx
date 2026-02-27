
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LIVE RTP SUHUCUAN: Cara Cerdas Menang Slot Online Terbaru 2026",
  description: "Cek RTP slot terbaru secara langsung di SUHUCUAN. Fitur LIVE RTP bantu Anda pilih game dengan peluang tertinggi dan strategi menang yang lebih besar.",
  icons: {
    icon: "/favicon1.png",
  },
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
