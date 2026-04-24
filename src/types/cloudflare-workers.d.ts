declare module 'cloudflare:workers' {
  export const env: {
    RESEND_API_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    [key: string]: string | undefined;
  };
}
