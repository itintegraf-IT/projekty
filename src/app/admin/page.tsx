import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import AdminDashboard from "./_components/AdminDashboard";

export default async function AdminPage() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") redirect("/");
  return <AdminDashboard currentUser={session} />;
}
