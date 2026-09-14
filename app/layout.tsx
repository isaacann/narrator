import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "narrator",
  description:
    "Turn text into natural, human-like speech with your browser's built-in voice engine — no API key needed.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
