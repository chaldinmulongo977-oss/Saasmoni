import { getSettings } from "./settings.js";
const BASE = "https://api.saspay.me/api/v1";
export class SasPayError extends Error {
  constructor(public status: number, public code: string, msg: string) { super(msg); }
}
async function call<T>(path: string, o: { method?: string; body?: unknown; idem?: string } = {}): Promise<T> {
  const key = (await getSettings()).apiKey;
  if (!key) throw new SasPayError(503, "not_configured", "Clé SasPay non configurée");
  const res = await fetch(BASE + path, {
    method: o.method ?? "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(o.idem ? { "Idempotency-Key": o.idem } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new SasPayError(res.status, json?.error?.code ?? `http_${res.status}`, json?.error?.message ?? JSON.stringify(json).slice(0, 300));
  return (json?.data ?? json) as T;
}
export type Softpay = { id: string; status: string; checkout_url?: string };
export type Verify = { status: "PENDING" | "SUCCESS" | "FAILED"; net_amount?: string; currency?: string };
export const softpay = (body: unknown, idem: string) => call<Softpay>("/payments/softpay/", { method: "POST", body, idem });
export const verify = (id: string) => call<Verify>(`/payments/${encodeURIComponent(id)}/verify/`);
export const ping = () => call<unknown>("/pricing/my-rates/");          // valide la clé + réseaux disponibles
export const listWebhooks = () => call<unknown>("/merchant-webhooks/"); // lecture seule : création = tableau de bord SasPay
