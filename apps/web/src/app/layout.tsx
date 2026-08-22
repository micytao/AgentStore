import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { RoleProvider } from "@/lib/role";
import { Fraunces, Outfit } from "next/font/google";
import type { ReactNode } from "react";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  style: ["normal", "italic"],
});

export const metadata = {
  title: "Agent Store",
  description: "Internal catalog of governed AI agents",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${fraunces.variable}`}>
      <body className={outfit.className}>
        <div className="store-aurora" aria-hidden="true" />
        <RoleProvider>
          <AppShell>{children}</AppShell>
        </RoleProvider>
      </body>
    </html>
  );
}
