import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import ReportDashboard from "./_components/ReportDashboard";

export default async function ReportyPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Druhá vrstva vedle middleware, stejně jako u /admin (audit D-1).
  // ADMIN i PLANOVAT — etapa 2 září 2026, volba R1 = A.
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) redirect("/");

  return <ReportDashboard />;
}
