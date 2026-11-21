import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/config';

describe('server config', () => {
  it('refuses live Stripe keys unless explicitly allowed', () => {
    const blocked = loadConfig({ STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
    expect(blocked.stripeSecretKey).toBeNull();
    expect(blocked.stripeMode).toBeNull();
    expect(blocked.warnings.join(' ')).toMatch(/STRIPE_ALLOW_LIVE/);

    const allowed = loadConfig({
      STRIPE_SECRET_KEY: 'sk_live_abc',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_ALLOW_LIVE: 'true',
    });
    expect(allowed.stripeMode).toBe('live');
  });

  it('disables online payments without a webhook secret', () => {
    const config = loadConfig({ STRIPE_SECRET_KEY: 'sk_test_abc' });
    expect(config.stripeSecretKey).toBeNull();
    expect(config.warnings.join(' ')).toMatch(/STRIPE_WEBHOOK_SECRET/);
  });

  it('uses test mode for test keys', () => {
    expect(loadConfig({ STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: 'whsec_x' }).stripeMode).toBe('test');
  });

  it('has conservative reservation defaults', () => {
    const config = loadConfig({});
    expect(config.checkoutHoldMinutes).toBe(30);
    expect(config.requestAutoReleaseHours).toBe(0); // never auto-cancel requests unless configured
  });

  it('clamps the checkout hold to what Stripe allows', () => {
    expect(loadConfig({ CHECKOUT_HOLD_MINUTES: '5' }).checkoutHoldMinutes).toBe(30);
    expect(loadConfig({ CHECKOUT_HOLD_MINUTES: '5000' }).checkoutHoldMinutes).toBe(1440);
    expect(loadConfig({ CHECKOUT_HOLD_MINUTES: 'soon' }).checkoutHoldMinutes).toBe(30);
  });

  it('prefers SITE_URL over Netlify URL and trims slashes', () => {
    expect(loadConfig({ URL: 'https://a.netlify.app' }).siteUrl).toBe('https://a.netlify.app');
    expect(loadConfig({ URL: 'https://a.netlify.app', SITE_URL: 'https://signs.example/' }).siteUrl).toBe(
      'https://signs.example',
    );
  });
});
