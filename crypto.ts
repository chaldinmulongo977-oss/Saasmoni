import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
const key = () => {
  const k = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY doit faire 32 octets (base64)");
  return k;
};
export const encrypt = (plain: string) => {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
};
export const decrypt = (s: string) => {
  const [iv, tag, enc] = s.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
};
