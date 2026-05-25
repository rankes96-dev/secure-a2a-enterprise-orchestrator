type AccessDeniedScreenProps = {
  email?: string;
  provider?: string;
  isLoading: boolean;
  onLogout: () => void;
};

export function AccessDeniedScreen({ email, provider, isLoading, onLogout }: AccessDeniedScreenProps) {
  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="access-denied-title">
        <p className="eyebrow">Secure A2A Gateway</p>
        <h1 id="access-denied-title">Access denied.</h1>
        <p>Your user is not enabled for this gateway.</p>
        <p>Contact the gateway administrator.</p>
        {email || provider ? (
          <div className="auth-safe-detail" aria-label="Safe identity detail">
            {email ? <span>{email}</span> : null}
            {provider ? <span>{provider}</span> : null}
          </div>
        ) : null}
        <button type="button" className="secondary-button" onClick={onLogout} disabled={isLoading}>
          Logout
        </button>
      </section>
    </main>
  );
}
