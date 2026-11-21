import { useState, type FormEvent } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router';
import { Notice, Spinner, useDocumentTitle } from '../../components/ui';
import { SHOP_NAME } from '../../config';
import { AdminAuthProvider, useAdminAuth } from './AdminAuth';
import { OrderDetailPage } from './OrderDetailPage';
import { OrdersPage } from './OrdersPage';
import { SignEditPage } from './SignEditPage';
import { SignsPage } from './SignsPage';
import { requireSupabase } from './supabaseClient';

export default function AdminApp() {
  return (
    <AdminAuthProvider>
      <AdminGate />
    </AdminAuthProvider>
  );
}

function AdminGate() {
  const { auth, signOut } = useAdminAuth();
  useDocumentTitle('Admin');

  let content;
  if (auth.status === 'loading' || (auth.status === 'signed_in' && auth.isAdmin === null)) {
    content = <Spinner label="Checking your session…" />;
  } else if (auth.status === 'unconfigured') {
    content = (
      <Notice tone="warning" title="Supabase is not configured">
        Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild. See the README.
      </Notice>
    );
  } else if (auth.status === 'signed_out') {
    content = <LoginForm />;
  } else if (auth.status === 'recovery') {
    content = <SetPasswordForm />;
  } else if (!auth.isAdmin) {
    content = (
      <Notice
        tone="error"
        title="Not an admin account"
        action={
          <button type="button" className="button button-secondary" onClick={signOut}>
            Sign out
          </button>
        }
      >
        You're signed in as {auth.session.user.email}, but this account isn't allowed to manage the shop. Add its user
        id to the <code>admins</code> table (see the README).
      </Notice>
    );
  } else {
    return (
      <div className="admin">
        <header className="site-header admin-header">
          <div className="container header-inner">
            <Link to="/admin" className="brand">
              {SHOP_NAME} <span className="admin-tag">Admin</span>
            </Link>
            <nav aria-label="Admin">
              <NavLink to="/admin" end>
                Orders
              </NavLink>
              <NavLink to="/admin/signs">Signs</NavLink>
              <a href="/" target="_blank" rel="noreferrer">
                Shop ↗
              </a>
              <button type="button" className="link-button" onClick={signOut}>
                Sign out
              </button>
            </nav>
          </div>
        </header>
        <main id="main" className="container main">
          <Routes>
            <Route index element={<OrdersPage />} />
            <Route path="orders/:orderId" element={<OrderDetailPage />} />
            <Route path="signs" element={<SignsPage />} />
            <Route path="signs/new" element={<SignEditPage />} />
            <Route path="signs/:signId" element={<SignEditPage />} />
            <Route path="*" element={<Notice title="Not found">That admin page doesn't exist.</Notice>} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <div className="admin">
      <header className="site-header admin-header">
        <div className="container header-inner">
          <Link to="/" className="brand">
            {SHOP_NAME} <span className="admin-tag">Admin</span>
          </Link>
        </div>
      </header>
      <main id="main" className="container main narrow">
        {content}
      </main>
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    const { error: signInError } = await requireSupabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (signInError) {
      setError(
        signInError.message.toLowerCase().includes('invalid')
          ? 'Email or password is incorrect.'
          : `Couldn't sign in: ${signInError.message}`,
      );
    }
  }

  async function onReset() {
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError('Enter your email above first, then choose "Forgot password".');
      return;
    }
    setBusy(true);
    const { error: resetError } = await requireSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/admin`,
    });
    setBusy(false);
    if (resetError) setError(`Couldn't send a reset link: ${resetError.message}`);
    else setInfo('If that email has an account, a password reset link is on its way.');
  }

  return (
    <form className="card auth-form" onSubmit={onSubmit} noValidate>
      <h1>Owner sign in</h1>
      {error && <Notice tone="error">{error}</Notice>}
      {info && <Notice tone="success">{info}</Notice>}
      <div className="field">
        <label htmlFor="admin-email">Email</label>
        <input id="admin-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <button type="submit" className="button button-block" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <button type="button" className="link-button" onClick={onReset} disabled={busy}>
        Forgot password?
      </button>
    </form>
  );
}

function SetPasswordForm() {
  const { finishRecovery } = useAdminAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 10) {
      setError('Use at least 10 characters.');
      return;
    }
    setBusy(true);
    const { error: updateError } = await requireSupabase().auth.updateUser({ password });
    setBusy(false);
    if (updateError) setError(updateError.message);
    else finishRecovery();
  }

  return (
    <form className="card auth-form" onSubmit={onSubmit} noValidate>
      <h1>Set a new password</h1>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <button type="submit" className="button button-block" disabled={busy}>
        {busy ? 'Saving…' : 'Save password'}
      </button>
    </form>
  );
}
