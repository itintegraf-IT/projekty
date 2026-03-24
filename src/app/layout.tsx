import "./globals.css";
import type { ReactNode } from "react";
import Providers from "./providers";

export const metadata = {
  title: "Plánování výroby",
  description: "Interní plánovací nástroj pro XL 105 / XL 106"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground transition-colors duration-200">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
