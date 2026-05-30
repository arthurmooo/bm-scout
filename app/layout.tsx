import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BM Scout",
  description: "Console interne d'acquisition BM Automation"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
