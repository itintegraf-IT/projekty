import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import ReportDashboard from "./_components/ReportDashboard";

export default async function ReportyPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/");

  return <ReportDashboard />;
}
