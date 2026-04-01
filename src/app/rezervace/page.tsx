import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import RezervacePage from "./_components/RezervacePage";

const ALLOWED_ROLES = ["ADMIN", "PLANOVAT", "OBCHODNIK"];

export default async function RezervaciPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!ALLOWED_ROLES.includes(session.role)) redirect("/");

  const params = await searchParams;
  const initialId = params.id ? parseInt(params.id, 10) : undefined;

  return (
    <RezervacePage
      currentUser={{
        id: session.id,
        username: session.username,
        role: session.role,
      }}
      initialSelectedId={isNaN(initialId ?? NaN) ? undefined : initialId}
    />
  );
}
