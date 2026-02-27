// app/api/game-list-settings/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

type GameUpdate = {
  id: string;
  slug: string;
  display_name: string;
  provider: string;
  is_active: boolean;
  display_order: number | null;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const games = body.games as GameUpdate[] | undefined;

    if (!games || !Array.isArray(games)) {
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400 }
      );
    }

    const updates = games.map((g) => ({
      id: g.id,
      slug: g.slug,
      display_name: g.display_name,
      provider: g.provider,
      is_active: !!g.is_active,
      display_order: g.display_order
    }));

    const { error } = await supabaseAdmin
      .from("games")
      .upsert(updates, { onConflict: "id" });

    if (error) {
      console.error("Error updating games:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
