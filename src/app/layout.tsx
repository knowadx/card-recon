import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { getSession, isSuperadmin } from "@/lib/auth";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Finance Manager",
  description: "Multi-company financial management",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const superadmin = !!session && isSuperadmin(session.role);
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex bg-background text-foreground font-sans">
        <Sidebar isSuperadmin={superadmin} />
        <main className="flex-1 overflow-auto">{children}</main>
      </body>
    </html>
  );
}
