import Link from "next/link";
import { redirect } from "next/navigation";
import { getInternalAuthState } from "@/server/supabase-auth";

type LoginPageProps = {
  searchParams?: Promise<{ status?: string }>;
};

const statusCopy: Record<string, string> = {
  sent: "Lien de connexion envoyé si le compte existe et est autorisé.",
  auth_not_configured: "Auth Supabase non configurée : la console locale reste en mode démo.",
  signed_out: "Session fermée.",
  callback_error: "Connexion impossible. Demander à Arthur de vérifier le compte Supabase.",
  missing_code: "Lien de connexion incomplet.",
  missing_email: "Email requis."
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const auth = await getInternalAuthState();
  if (auth.mode === "authenticated") redirect("/" as Parameters<typeof redirect>[0]);

  const params = searchParams ? await searchParams : {};
  const status = typeof params.status === "string" ? params.status : null;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div>
          <p className="auth-kicker">BM Scout</p>
          <h1>Accès interne</h1>
          <p className="auth-copy">
            Connexion réservée aux comptes Supabase avec rôle BM Scout dans `app_metadata`. Aucun envoi automatique en V1.
          </p>
        </div>

        {status ? <p className="auth-status">{statusCopy[status] ?? status}</p> : null}
        {auth.mode === "forbidden" ? <p className="auth-error">{auth.reason}</p> : null}
        {auth.mode === "demo_unconfigured" ? (
          <p className="auth-status">
            Mode démo local actif. Configure `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` et `BM_SCOUT_AUTH_MODE=internal`
            pour forcer l’accès authentifié.
          </p>
        ) : null}

        <form className="auth-form" action="/auth/login" method="post">
          <label htmlFor="email">Email interne</label>
          <input id="email" name="email" type="email" autoComplete="email" placeholder="romu@..." required />
          <button className="button primary" type="submit">Envoyer le lien</button>
        </form>

        {auth.mode === "demo_unconfigured" ? <Link className="auth-link" href="/">Ouvrir la console démo</Link> : null}
      </section>
    </main>
  );
}
