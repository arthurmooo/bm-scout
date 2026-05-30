import { getScoutSnapshot } from "@/server/scout-repository";
import { ScoutDashboard } from "@/ui/ScoutDashboard";

export default async function Home() {
  const snapshot = await getScoutSnapshot();
  return <ScoutDashboard snapshot={snapshot} />;
}
