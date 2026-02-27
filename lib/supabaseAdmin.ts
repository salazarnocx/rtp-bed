import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Sedikit guard biar kalau env lupa diisi, langsung kelihatan.
if (!url) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
}
if (!serviceKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
}

// Client ini HANYA boleh dipakai di server (route.ts / server actions),
// jangan pernah di-import di komponen "use client".
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: {
    persistSession: false
  }
});
