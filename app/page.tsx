import { redirect } from "next/navigation";
import { getInternalAuthState } from "@/server/supabase-auth";
import { getScoutSnapshot } from "@/server/scout-repository";
import { ScoutDashboard } from "@/ui/ScoutDashboard";

export default async function Home() {
  const auth = await getInternalAuthState();
  if (auth.mode === "unauthenticated") redirect("/login" as Parameters<typeof redirect>[0]);
  if (auth.mode === "forbidden") return <ForbiddenAccess email={auth.email} reason={auth.reason} />;

  const snapshot = await getScoutSnapshot();
  const accessLabel = auth.mode === "authenticated" ? `${auth.email ?? "interne"} · ${auth.roles.join(", ")}` : undefined;
  return <ScoutDashboard snapshot={snapshot} accessLabel={accessLabel} />;
}

function ForbiddenAccess({ email, reason }: { email: string | null; reason: string }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div>
          <p className="auth-kicker">BM Scout</p>
          <h1>Accès refusé</h1>
          <p className="auth-copy">
            {email ?? "Ce compte"} est authentifié, mais il n&apos;a pas de rôle interne BM Scout dans `app_metadata`.
          </p>
        </div>
        <p className="auth-error">{reason}</p>
        <form action="/auth/logout" method="post">
          <button className="button primary" type="submit">Déconnexion</button>
        </form>
      </section>
    </main>
  );
}
