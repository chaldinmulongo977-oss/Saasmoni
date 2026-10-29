import { db } from "./db.js";
import { decrypt } from "./crypto.js";
export type Settings = { apiKey: string | null; webhookSecret: string | null; enabled: boolean; feeMode: "ADD_ON" | "DEDUCTED" };
let cache: { at: number; v: Settings } | null = null;
export const clearSettingsCache = () => { cache = null; };
export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.v;
  const { data, error } = await db.from("payment_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  const v: Settings = {
    apiKey: data.api_key_enc ? decrypt(data.api_key_enc) : null,
    webhookSecret: data.webhook_secret_enc ? decrypt(data.webhook_secret_enc) : null,
    enabled: data.enabled, feeMode: data.fee_charge_mode,
  };
  cache = { at: Date.now(), v };
  return v;
}
