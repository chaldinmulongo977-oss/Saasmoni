import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";
import * as sas from "./saspay.js";

export function webhookIsValid(raw: Buffer, sig: string, ts: string, secret: string): boolean {
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const exp = Buffer.from(createHmac("sha256", secret).update(`${ts}.`).update(raw).digest("hex"));
  const got = Buffer.from(sig);
  return exp.length === got.length && timingSafeEqual(exp, got);
}

// Seule source de vérité : GET /payments/{id}/verify/. Livraison une seule fois (fonction SQL atomique).
export async function reconcile(p: { id: string; provider_payment_id: string }) {
  const v = await sas.verify(p.provider_payment_id);
  if (v.status === "FAILED") {
    await db.from("payments").update({ status: "FAILED" }).eq("id", p.id).eq("status", "PENDING");
    return "FAILED";
  }
  if (v.status !== "SUCCESS") return "PENDING";
  await db.rpc("activate_payment", { p_id: p.id, p_net: v.net_amount ?? null });
  return "SUCCESS";
}

export async function reconcilePending() {
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const { data } = await db.from("payments").select("id, provider_payment_id")
    .eq("status", "PENDING").not("provider_payment_id", "is", null).gte("created_at", since).limit(25);
  for (const p of data ?? []) {
    try { await reconcile(p as { id: string; provider_payment_id: string }); }
    catch (e: any) { if (e instanceof sas.SasPayError && e.status === 429) break; console.error("reconcile", p.id, e.code ?? e.message); }
  }
}
