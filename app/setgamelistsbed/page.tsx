// app/setgamelistssps/page.tsx
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import GameListSettingsClient from "../../components/GameListSettingsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 1000;

export default async function SetGameListPage() {
  let from = 0;
  const allGames: any[] = [];

  // loop ambil 1000–1000 sampai habis
  // (max-row Supabase per request = 1000)
  // kita tetap order by display_order + display_name di server
  // supaya konsisten.
  // Supabase PostgREST akan apply ORDER lalu RANGE,
  // jadi kombinasi ini aman untuk pagination.
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("games")
      .select(
        "id, slug, display_name, provider, is_active, display_order"
      )
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("display_name", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      break;
    }

    allGames.push(...data);

    // kalau sudah kurang dari PAGE_SIZE, berarti data habis
    if (data.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return (
    <GameListSettingsClient initialGames={allGames as any} />
  );
}
