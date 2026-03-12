import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import ReportView from "./ReportView";

export default async function DailyReportPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) redirect("/");

  return (
    <Suspense fallback={
      <div style={{ fontFamily: "-apple-system, sans-serif", padding: 40, color: "#6b7280" }}>
        Načítám data…
      </div>
    }>
      <ReportView />
    </Suspense>
  );
}
