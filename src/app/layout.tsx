import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Plánování výroby",
  description: "Interní plánovací nástroj pro XL 105 / XL 106"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );
}

