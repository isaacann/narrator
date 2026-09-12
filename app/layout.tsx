import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "narrator",
  description:
    "Turn text into natural, human-like speech with ElevenLabs, OpenAI, or your browser's built-in voice engine.",
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
