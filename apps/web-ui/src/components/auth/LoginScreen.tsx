import type { FrontendAuthConfig } from "../../auth/authTypes";

type LoginScreenProps = {
  authConfig: FrontendAuthConfig;
  error?: string;
  isLoading: boolean;
  onAuth0Login: () => void;
  onDemoLogin: () => void;
};

export function LoginScreen({ authConfig, error, isLoading, onAuth0Login, onDemoLogin }: LoginScreenProps) {
  const isAuth0 = authConfig.provider === "auth0";

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="login-title">
        <p className="eyebrow">Secure A2A Gateway</p>
        <h1 id="login-title">Secure A2A Gateway</h1>
        <p>Sign in to continue.</p>
        <p>AI agent execution is blocked until your identity is verified.</p>
        <div className="auth-actions">
          {isAuth0 ? (
            <button type="button" className="trust-login-primary" onClick={onAuth0Login} disabled={isLoading || !authConfig.isConfigured}>
              Login with Auth0
            </button>
          ) : (
            <button type="button" className="trust-login-primary" onClick={onDemoLogin} disabled={isLoading}>
              Use demo identity
            </button>
          )}
        </div>
        {isAuth0 && !authConfig.isConfigured ? <p className="auth-safe-error">Auth0 login is not configured for this deployment.</p> : null}
        {error ? <p className="auth-safe-error" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
