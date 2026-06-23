import { redirect } from "next/navigation";
import { getSession, isSuperadmin } from "@/lib/auth";

// Control é restrito a superadmin (esconder do menu não basta — protege a rota direta).
export default async function ControlLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !isSuperadmin(session.role)) redirect("/");
  return <>{children}</>;
}
