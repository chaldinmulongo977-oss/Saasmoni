import { createClient } from "@supabase/supabase-js";
// Clé service_role : serveur uniquement, jamais exposée au frontend.
export const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
