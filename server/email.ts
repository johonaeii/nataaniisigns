import type { Logger } from './log';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

/** Sends email. Implementations never throw: a failed email must not fail an order. */
export interface Mailer {
  readonly enabled: boolean;
  send(message: EmailMessage): Promise<boolean>;
}

export function createResendMailer(options: {
  apiKey: string;
  from: string;
  log: Logger;
  fetchImpl?: typeof fetch;
}): Mailer {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    enabled: true,
    async send(message) {
      try {
        const response = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          options.log.error('email_send_failed', { status: response.status, body: await response.text() });
          return false;
        }
        return true;
      } catch (error) {
        options.log.error('email_send_failed', { error: String(error) });
        return false;
      }
    },
  };
}

export function createDisabledMailer(log: Logger): Mailer {
  return {
    enabled: false,
    async send(message) {
      log.info('email_skipped_not_configured', { subject: message.subject });
      return false;
    },
  };
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
