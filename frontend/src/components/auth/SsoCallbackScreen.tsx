import GaDongLogo from '@/components/GaDongLogo';
import { AuthAlert, AUTH_PRIMARY } from '@/components/auth/AuthSplit';

/** The two SSO callback pages render this while the code is exchanged, or when it fails. */
export default function SsoCallbackScreen({ provider, status, errorMsg, onBack }: { provider: 'Google' | 'Microsoft'; status: 'loading' | 'error'; errorMsg?: string; onBack: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-page px-5 py-10 font-sans">
      <div className="w-full max-w-[440px] flex flex-col gap-6">
        <GaDongLogo variant="light" markSize={30} />
        <div className="bg-paper border border-rule rounded-card shadow-card p-6 sm:p-8 flex flex-col gap-5" role="status" aria-live="polite">
          {status === 'error' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-ink">Sign-in didn&apos;t complete</h1>
                <p className="text-sm text-muted">We couldn&apos;t finish signing you in with {provider}.</p>
              </div>
              {errorMsg && <AuthAlert>{errorMsg}</AuthAlert>}
              <button type="button" onClick={onBack} className={AUTH_PRIMARY}>Back to sign in</button>
            </>
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-9 h-9 border-[3px] border-rule border-t-accent animate-spin rounded-full shrink-0" />
              <div>
                <p className="text-sm font-bold text-ink">Completing sign-in</p>
                <p className="text-[13px] text-muted">Verifying your {provider} account…</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
