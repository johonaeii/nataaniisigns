import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, useRouteError } from 'react-router';
import { Layout } from './components/Layout';
import { Notice, Spinner } from './components/ui';
import { CartProvider } from './lib/CartContext';
import { loadCheckoutPage, loadCustomRequestPage } from './lib/lazyPages';
import { CartPage } from './pages/CartPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderPage } from './pages/OrderPage';
import { ShopPage } from './pages/ShopPage';
import { SignPage } from './pages/SignPage';

// The admin area (and the Supabase client it needs) is a separate bundle, so
// shoppers on a phone at the market never download it.
const AdminApp = lazy(() => import('./pages/admin/AdminApp'));

// Checkout (with its form validation library) loads on demand; the cart page prefetches it.
const CheckoutPage = lazy(() => loadCheckoutPage().then((m) => ({ default: m.CheckoutPage })));
const CustomRequestPage = lazy(() => loadCustomRequestPage().then((m) => ({ default: m.CustomRequestPage })));

function RouteError() {
  const error = useRouteError();
  console.error(error);
  return (
    <main className="container main">
      <Notice
        tone="error"
        title="Something went wrong"
        action={
          <a className="button button-secondary" href="/">
            Back to the shop
          </a>
        }
      >
        Please reload the page and try again.
      </Notice>
    </main>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <ShopPage /> },
      { path: 'signs/:signId', element: <SignPage /> },
      { path: 'cart', element: <CartPage /> },
      {
        path: 'checkout',
        element: (
          <Suspense fallback={<Spinner label="Loading checkout…" />}>
            <CheckoutPage />
          </Suspense>
        ),
      },
      { path: 'order/:orderId', element: <OrderPage /> },
      {
        path: 'custom',
        element: (
          <Suspense fallback={<Spinner label="Loading…" />}>
            <CustomRequestPage />
          </Suspense>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: 'admin/*',
    errorElement: <RouteError />,
    element: (
      <Suspense
        fallback={
          <main className="container main">
            <Spinner label="Loading admin…" />
          </main>
        }
      >
        <AdminApp />
      </Suspense>
    ),
  },
]);

export function App() {
  return (
    <CartProvider>
      <RouterProvider router={router} />
    </CartProvider>
  );
}
