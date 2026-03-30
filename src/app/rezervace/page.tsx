import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import RezervacePage from "./_components/RezervacePage";

const ALLOWED_ROLES = ["ADMIN", "PLANOVAT", "OBCHODNIK"];

export default async function RezervaciPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!ALLOWED_ROLES.includes(session.role)) redirect("/");

  return (
    <RezervacePage
      currentUser={{
        id: session.id,
        username: session.username,
        role: session.role,
      }}
    />
  );
}
