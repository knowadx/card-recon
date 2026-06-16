import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Card Recon — Gasto × Cobrança",
  description: "Conciliação de gasto Meta Ads × cobranças no cartão por BM/Conta",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/accounts", label: "Contas" },
  { href: "/cards", label: "Cartões" },
  { href: "/charges", label: "Cobranças" },
  { href: "/settings", label: "Config" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-slate-50 text-slate-900 flex flex-col">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
            <span className="font-semibold tracking-tight">🛡️ Card Recon</span>
            <nav className="flex gap-4 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-slate-600 hover:text-slate-900">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
