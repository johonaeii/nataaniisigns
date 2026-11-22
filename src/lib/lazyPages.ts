// Code-split pages. Kept in one module so pages can prefetch each other without
// circular imports through App.tsx.
export const loadCheckoutPage = () => import('../pages/CheckoutPage');
export const loadCustomRequestPage = () => import('../pages/CustomRequestPage');
