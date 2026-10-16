import { redirect } from "next/navigation";
import { getCurrentUser, isManager } from "@/lib/auth";

// Control: superadmin e admins (cada admin vê só o próprio escopo — a API filtra). Esconder do menu
// não basta: protege a rota direta. Usa o MESMO login das APIs (Cloudflare Access ou cookie) e o
// papel do BANCO — o cookie de sessão antigo não existe com o Access ligado (era isso que mandava
// todo mundo de volta pro Dashboard).
export default async function ControlLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || !isManager(user.role)) redirect("/");
  return <>{children}</>;
}
