import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "./db.js";
import { encrypt } from "./crypto.js";
import { clearSettingsCache, getSettings } from "./settings.js";
import * as sas from "./saspay.js";
import { tick } from "./monitor.js";
import { reconcile, reconcilePending, webhookIsValid } from "./billing.js";

type Authed = Request & { user: { id: string; email: string; role: string } };
const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use((req, res, next) => { // CORS : uniquement le frontend déclaré
  const o = process.env.FRONTEND_URL;
  if (o && req.headers.origin === o) {
    res.setHeader("Access-Control-Allow-Origin", o); res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

function sendErr(res: Response, e: unknown) {
  if (e instanceof sas.SasPayError) {
    const map: Record<number, number> = { 401: 502, 403: 502, 404: 404, 409: 409, 422: 422, 429: 503 };
    const message = e.status === 401 ? "Clé SasPay invalide ou expirée" : e.status === 429 ? "Trop de requêtes, réessayez dans un instant" : e.message;
    return res.status(map[e.status] ?? 502).json({ error: e.code, message });
  }
  console.error(e instanceof Error ? e.message : e);
  return res.status(500).json({ error: "internal" });
}

// 1) Webhook : corps BRUT, monté avant express.json(). Le webhook est un signal, verify reste la vérité.
app.post("/api/saspay/webhook", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const s = await getSettings().catch(() => null);
  const ok = s?.webhookSecret && Buffer.isBuffer(req.body) &&
    webhookIsValid(req.body, String(req.headers["x-webhook-signature"] ?? ""), String(req.headers["x-webhook-timestamp"] ?? ""), s.webhookSecret);
  if (!ok) return res.status(401).end();
  res.status(200).end();                       // répondre vite, traiter ensuite
  void reconcilePending().catch((e) => console.error("webhook reconcile", e.message));
});

app.use(express.json({ limit: "20kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 60 }));

async function auth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  const { data } = token ? await db.auth.getUser(token) : { data: { user: null } };
  if (!data.user) return res.status(401).json({ error: "unauthorized" });
  const { data: prof } = await db.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  (req as Authed).user = { id: data.user.id, email: data.user.email ?? "", role: prof?.role ?? "client" };
  next();
}
const superOnly = (req: Request, res: Response, next: NextFunction) =>
  (req as Authed).user.role === "superadmin" ? next() : res.status(403).json({ error: "forbidden" });

// 2) Client : créer un paiement d'abonnement (le montant vient de la base, jamais du navigateur)
const Checkout = z.object({
  plan_id: z.string(), period: z.enum(["monthly", "annual"]), country: z.string().length(2), network: z.string().min(2),
  phone: z.string().regex(/^\+\d{8,15}$/), first_name: z.string().min(1).max(80), last_name: z.string().min(1).max(80),
});
app.post("/api/checkout", auth, async (req, res) => {
  const u = (req as Authed).user;
  const b = Checkout.safeParse(req.body);
  if (!b.success) return res.status(400).json(b.error.flatten());
  const s = await getSettings();
  if (!s.enabled || !s.apiKey) return res.status(503).json({ error: "payments_disabled" });
  const { data: cfg } = await db.from("app_settings").select("maintenance").eq("id", 1).single();
  if (cfg?.maintenance) return res.status(503).json({ error: "maintenance", message: "Système en maintenance" });
  const { data: plan } = await db.from("plans").select("id, currency, monthly:price_monthly::text, annual:price_annual::text").eq("id", b.data.plan_id).eq("active", true).maybeSingle();
  const amount = b.data.period === "annual" ? plan?.annual : plan?.monthly;
  if (!plan || !amount) return res.status(404).json({ error: "plan_not_found" });
  const { data: pay, error } = await db.from("payments").insert({ user_id: u.id, plan_id: plan.id, period: b.data.period, amount, currency: plan.currency }).select("id, idempotency_key").single();
  if (error) return sendErr(res, error);
  try {
    const r = await sas.softpay({
      amount, currency: plan.currency, country: b.data.country.toUpperCase(), network: b.data.network,
      description: `Abonnement ${plan.id}`, fee_charge_mode: s.feeMode, metadata: { payment_id: pay.id },
      customer: { email: u.email, first_name: b.data.first_name, last_name: b.data.last_name, phone: b.data.phone },
    }, pay.idempotency_key);
    await db.from("payments").update({ provider_payment_id: r.id }).eq("id", pay.id);
    res.json({ payment_id: pay.id, status: r.status, checkout_url: r.checkout_url || null }); // si non vide : rediriger le client
  } catch (e) {
    if (e instanceof sas.SasPayError) await db.from("payments").update({ status: "FAILED" }).eq("id", pay.id); // sinon issue inconnue : reste PENDING
    sendErr(res, e);
  }
});

app.get("/api/payments/:id/status", auth, async (req, res) => {
  const { data: p } = await db.from("payments").select("id, status, provider_payment_id").eq("id", req.params.id).eq("user_id", (req as Authed).user.id).maybeSingle();
  if (!p) return res.status(404).json({ error: "not_found" });
  try { res.json({ status: p.status === "PENDING" && p.provider_payment_id ? await reconcile(p as any) : p.status }); }
  catch (e) { sendErr(res, e); }
});

// 3) Super administrateur : réglages SasPay depuis son espace (secrets chiffrés, jamais renvoyés)
const Settings = z.object({
  api_key: z.string().regex(/^sk_(test|live)_\S{8,}$/).optional(),
  webhook_secret: z.string().min(16).max(200).optional(),
  enabled: z.boolean().optional(), fee_charge_mode: z.enum(["ADD_ON", "DEDUCTED"]).optional(),
});
app.get("/api/admin/payment-settings", auth, superOnly, async (_req, res) => {
  const { data } = await db.from("payment_settings").select("api_key_last4, api_mode, webhook_secret_last4, enabled, fee_charge_mode, updated_at").eq("id", 1).single();
  res.json({ ...data, webhook_url: `${process.env.APP_URL}/api/saspay/webhook` });
});
app.put("/api/admin/payment-settings", auth, superOnly, async (req, res) => {
  const b = Settings.safeParse(req.body);
  if (!b.success) return res.status(400).json(b.error.flatten());
  const patch: Record<string, unknown> = { id: 1, updated_by: (req as Authed).user.id, updated_at: new Date().toISOString() };
  if (b.data.api_key) Object.assign(patch, { api_key_enc: encrypt(b.data.api_key), api_key_last4: b.data.api_key.slice(-4), api_mode: b.data.api_key.startsWith("sk_live_") ? "live" : "test" });
  if (b.data.webhook_secret) Object.assign(patch, { webhook_secret_enc: encrypt(b.data.webhook_secret), webhook_secret_last4: b.data.webhook_secret.slice(-4) });
  if (b.data.enabled !== undefined) patch.enabled = b.data.enabled;
  if (b.data.fee_charge_mode) patch.fee_charge_mode = b.data.fee_charge_mode;
  const { error } = await db.from("payment_settings").upsert(patch);
  if (error) return sendErr(res, error);
  clearSettingsCache();
  await db.from("audit_logs").insert({ actor_id: (req as Authed).user.id, action: "payment_settings.update", meta: { fields: Object.keys(b.data) } });
  res.json({ ok: true });
});
app.post("/api/admin/payment-settings/test", auth, superOnly, async (_req, res) => { try { await sas.ping(); res.json({ ok: true }); } catch (e) { sendErr(res, e); } });
app.get("/api/admin/saspay/webhooks", auth, superOnly, async (_req, res) => { try { res.json(await sas.listWebhooks()); } catch (e) { sendErr(res, e); } });

setInterval(() => void tick().catch((e) => console.error("tick", e.message)), 30_000); // moteur de surveillance
setInterval(() => void reconcilePending().catch(() => {}), 60_000); // filet de sécurité si un webhook est perdu
app.listen(Number(process.env.PORT ?? 3000), () => console.log("MoniSaaS payments prêt"));
