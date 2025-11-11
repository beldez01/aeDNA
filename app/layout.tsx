import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Art Master - Aesthetic Calculus",
  description: "Visual calculus and derivative analysis for images",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

