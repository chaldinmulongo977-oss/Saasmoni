import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db } from "./db.js";

const priv = (ip: string) =>
  /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) ||
  ip === "::1" || ip === "::" || /^(fc|fd|fe80)/i.test(ip) || ip.toLowerCase().startsWith("::ffff:");

// Anti-SSRF : destinations publiques uniquement, IP résolue et vérifiée avant la requête, redirections non suivies.
async function allowed(url: string) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) return false;
  const ips = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
  return ips.length > 0 && ips.every((a) => !priv(a.address));
}

const notify = (user_id: string, title: string, body: string) => db.from("notifications").insert({ user_id, title, body });

async function check(m: any) {
  let ok = false, status: number | null = null, error: string | null = null;
  const t = Date.now();
  try {
    if (!(await allowed(m.url))) throw new Error("destination_not_allowed");
    const r = await fetch(m.url, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "MoniSaaS/1.0" } });
    status = r.status; ok = status < 400; if (!ok) error = `HTTP ${status}`;
  } catch (e: any) { error = e.cause?.code ?? e.message; }
  const ms = Date.now() - t;
  await db.from("monitor_checks").insert({ monitor_id: m.id, ok, http_status: status, response_ms: ms, error });

  let next = m.status; const fails = ok ? 0 : m.fail_count + 1;
  if (ok) {
    if (m.status === "down") {
      await db.from("incidents").update({ resolved_at: new Date().toISOString() }).eq("monitor_id", m.id).is("resolved_at", null);
      await notify(m.user_id, `Service rétabli : ${m.name}`, `${m.url} répond de nouveau (${ms} ms).`);
    }
    next = "up";
  } else if (fails >= 3 && m.status !== "down") {          // panne confirmée après 3 échecs consécutifs
    next = "down";
    await db.from("incidents").insert({ monitor_id: m.id, user_id: m.user_id, last_error: error });
    await notify(m.user_id, `Panne détectée : ${m.name}`, `${m.url} — ${error} (3 contrôles échoués). Les vérifications continuent.`);
  }
  await db.from("monitors").update({ status: next, fail_count: fails, last_checked_at: new Date().toISOString(), last_response_ms: ms, last_error: error }).eq("id", m.id);
}

export async function tick() {
  const now = Date.now();
  await db.from("app_settings").update({ worker_seen_at: new Date(now).toISOString() }).eq("id", 1);
  const { data: subs } = await db.from("subscriptions").select("user_id, plans(interval_seconds)").eq("status", "active").gt("current_period_end", new Date(now).toISOString());
  const every = new Map((subs ?? []).map((s: any) => [s.user_id, s.plans?.interval_seconds ?? 300]));
  const { data: ms } = await db.from("monitors").select("*").eq("active", true).limit(200);
  const due = (ms ?? []).filter((m) => !m.last_checked_at || now - Date.parse(m.last_checked_at) >= (every.get(m.user_id) ?? 300) * 1000);
  for (let i = 0; i < due.length; i += 10) await Promise.allSettled(due.slice(i, i + 10).map(check));
}
