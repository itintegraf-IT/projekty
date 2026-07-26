import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getKioskDevices, pntidForUsername } from "@/lib/kioskDevices";
import { KioskShell } from "@/components/kiosk/KioskShell";

export default async function KioskPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const pntid = pntidForUsername(getKioskDevices(), session.username);
  const logicaBase = process.env.KIOSK_LOGICA_BASE ?? "https://logica.integraf.cz";
  const logicaUrl = pntid != null ? `${logicaBase}/machinepanelhand.aspx?pntid=${pntid}` : null;

  return (
    <KioskShell
      machine={session.assignedMachine}
      planUrl="/"
      logicaUrl={logicaUrl}
      defaultView="data"
    />
  );
}
