import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router';
import { CONTACT_EMAIL, SHOP_NAME } from '../config';
import { useCart } from '../lib/CartContext';

export function Layout() {
  const { count } = useCart();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="brand">
            {SHOP_NAME}
          </Link>
          <NavLink to="/cart" className="cart-link" aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="20" r="1.5" />
              <circle cx="18" cy="20" r="1.5" />
              <path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6" />
            </svg>
            <span>Cart</span>
            {count > 0 && (
              <span className="cart-count" aria-hidden="true">
                {count}
              </span>
            )}
          </NavLink>
        </div>
      </header>
      <main id="main" className="container main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container">
          <p>
            © {new Date().getFullYear()} {SHOP_NAME}
            {CONTACT_EMAIL && (
              <>
                {' · '}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </>
            )}
          </p>
          <p className="footer-small">
            Online payments are processed securely by Stripe. We never see or store your card details.
          </p>
        </div>
      </footer>
      <ScrollRestoration />
    </>
  );
}
