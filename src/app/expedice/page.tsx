import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ExpedicePage } from "./_components/ExpedicePage";

export default async function ExpedicniPlanPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <ExpedicePage role={session.role} />;
}
