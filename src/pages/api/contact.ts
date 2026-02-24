import type { APIRoute } from 'astro';
import { Resend } from 'resend';

// In-memory rate limit with timestamps
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60_000; // 60 seconds
const MAX_SUBMISSIONS = 3;

// RFC 5322-compliant email regex
const emailRegex =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

// Max field lengths
const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 2000;

const ALLOWED_SERVICES = ['soft-play', 'rodjendan', 'vjencanje', 'ostalo'];

export const prerender = false;

function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanExpiredEntries(ip: string, now: number): number[] {
  const timestamps = rateLimitMap.get(ip) || [];
  const valid = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
  if (valid.length === 0) {
    rateLimitMap.delete(ip);
  } else {
    rateLimitMap.set(ip, valid);
  }
  return valid;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const formData = await request.formData();
    const name = formData.get('name')?.toString().trim() ?? '';
    const email = formData.get('email')?.toString().trim() ?? '';
    const service = formData.get('service')?.toString().trim() ?? '';
    const message = formData.get('message')?.toString().trim() ?? '';
    const hp = formData.get('website_url')?.toString().trim() ?? '';

    // Honeypot — bots fill this hidden field
    if (hp) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate required fields
    if (!name || !email || !service || !message) {
      return new Response(
        JSON.stringify({ error: 'Sva polja su obavezna.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Field length validation
    if (name.length > MAX_NAME) {
      return new Response(
        JSON.stringify({ error: 'Ime je predugačko.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (email.length > MAX_EMAIL) {
      return new Response(
        JSON.stringify({ error: 'E-mail adresa je predugačka.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (message.length > MAX_MESSAGE) {
      return new Response(
        JSON.stringify({ error: 'Poruka je predugačka (maks. 2000 znakova).' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Unesite ispravnu e-mail adresu.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate service value
    if (!ALLOWED_SERVICES.includes(service)) {
      return new Response(
        JSON.stringify({ error: 'Nepoznata vrsta usluge.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Rate limiting per IP using sliding window
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    const now = Date.now();
    const recentRequests = cleanExpiredEntries(ip, now);

    if (recentRequests.length >= MAX_SUBMISSIONS) {
      return new Response(
        JSON.stringify({ error: 'Previše zahtjeva. Pokušajte ponovo za minutu.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    recentRequests.push(now);
    rateLimitMap.set(ip, recentRequests);

    // Get API key from Cloudflare runtime env
    const runtime = (locals as Record<string, unknown>).runtime as { env?: { RESEND_API_KEY?: string } } | undefined;
    const resendApiKey = runtime?.env?.RESEND_API_KEY;

    if (!resendApiKey) {
      console.error('Missing RESEND_API_KEY');
      return new Response(
        JSON.stringify({ error: 'Email servis nije konfiguriran.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const resend = new Resend(resendApiKey);

    const safeName = sanitizeHtml(name);
    const safeEmail = sanitizeHtml(email);
    const safeService = sanitizeHtml(service);
    const safeMessage = sanitizeHtml(message);

    await resend.emails.send({
      from: 'Kiddos Kontakt <noreply@kiddos-events.hr>',
      to: ['kontakt@kiddos-events.hr'],
      replyTo: email,
      subject: `Novi upit — ${safeService}`,
      html: `
        <h2>Novi upit s web stranice</h2>
        <p><strong>Ime:</strong> ${safeName}</p>
        <p><strong>E-mail:</strong> ${safeEmail}</p>
        <p><strong>Usluga:</strong> ${safeService}</p>
        <p><strong>Poruka:</strong></p>
        <p>${safeMessage.replace(/\n/g, '<br />')}</p>
      `,
    });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Contact form error:', error);

    return new Response(
      JSON.stringify({ error: 'Interna greška. Pokušajte ponovo.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
