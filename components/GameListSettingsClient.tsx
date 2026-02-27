"use client";

import { useMemo, useState } from "react";
import type { ProviderCode } from "../lib/spinConfig";
import { PROVIDER_META } from "../lib/providerMeta";

type GameConfigRow = {
  id: string;
  slug: string;
  display_name: string;
  provider: ProviderCode;
  is_active: boolean;
  display_order: number | null;
};

type Props = {
  initialGames: GameConfigRow[];
};

type ProviderFilter = "ALL" | ProviderCode;

export default function GameListSettingsClient({ initialGames }: Props) {
  const [games, setGames] = useState<GameConfigRow[]>(() => {
    const copy = [...initialGames];
    // urutan awal: berdasarkan display_order (kosong di belakang) lalu nama
    copy.sort((a, b) => {
      const ao = a.display_order ?? 999999;
      const bo = b.display_order ?? 999999;
      if (ao !== bo) return ao - bo;
      return a.display_name.localeCompare(b.display_name);
    });
    return recomputeActiveOrder(copy);
  });

  const [providerFilter, setProviderFilter] =
    useState<ProviderFilter>("ALL");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const visibleGames = useMemo(() => {
    return games.filter((g) => {
      if (providerFilter !== "ALL" && g.provider !== providerFilter)
        return false;
      if (!search.trim()) return true;
      return g.display_name
        .toLowerCase()
        .includes(search.toLowerCase());
    });
  }, [games, providerFilter, search]);

  const visibleIds = useMemo(
    () => new Set(visibleGames.map((g) => g.id)),
    [visibleGames]
  );

  const allVisibleChecked =
    visibleGames.length > 0 &&
    visibleGames.every((g) => g.is_active);

  const someVisibleChecked = visibleGames.some((g) => g.is_active);

  const handleToggleActive = (id: string, value: boolean) => {
    setGames((prev) => {
      const updated = prev.map((g) =>
        g.id === id ? { ...g, is_active: value } : g
      );
      return recomputeActiveOrder(updated);
    });
    setSaveMessage(null);
    setErrorMessage(null);
  };

  const handleToggleAllVisible = (checked: boolean) => {
    setGames((prev) => {
      const updated = prev.map((g) =>
        visibleIds.has(g.id) ? { ...g, is_active: checked } : g
      );
      return recomputeActiveOrder(updated);
    });
    setSaveMessage(null);
    setErrorMessage(null);
  };

  const handleOrderChange = (id: string, raw: string) => {
    const parsed = raw === "" ? null : Number(raw);
    setGames((prev) =>
      prev.map((g) =>
        g.id === id
          ? {
              ...g,
              display_order:
                parsed == null || Number.isNaN(parsed) ? null : parsed,
            }
          : g
      )
    );
    setSaveMessage(null);
    setErrorMessage(null);
  };

  // Pindah posisi berdasarkan nilai Order:
  // - sort semua game aktif menurut display_order (kecil -> besar)
  // - aktif ditaruh di atas, non-aktif di bawah
  // - lalu nomor ulang display_order 1..N
  const handleMove = (id: string) => {
    setGames((prev) => {
      const items = [...prev];

      // kalau game yang diklik belum aktif, tidak usah apa-apa
      const clicked = items.find((g) => g.id === id);
      if (!clicked || !clicked.is_active) {
        return prev;
      }

      // entries aktif beserta index lama (dipakai sebagai tie-breaker)
      const activeEntries = items
        .map((g, idx) => ({ g, idx }))
        .filter(({ g }) => g.is_active);

      // sort berdasarkan angka order yang diinput
      activeEntries.sort((a, b) => {
        const ao =
          a.g.display_order ?? Number.MAX_SAFE_INTEGER;
        const bo =
          b.g.display_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        // kalau angkanya sama, pertahankan urutan lama
        return a.idx - b.idx;
      });

      const activeGames = activeEntries.map((e) => e.g);
      const inactiveGames = items.filter((g) => !g.is_active);

      const merged = [...activeGames, ...inactiveGames];

      return recomputeActiveOrder(merged);
    });

    setSaveMessage(null);
    setErrorMessage(null);
  };

  // DRAG & DROP antar baris aktif
  const handleDragStart = (id: string) => {
    setDragId(id);
  };

  const handleDragOver = (
    e: React.DragEvent<HTMLTableRowElement>,
    overId: string
  ) => {
    e.preventDefault();
    if (!dragId || dragId === overId) return;

    setGames((prev) => {
      const items = [...prev];
      const fromIndex = items.findIndex((g) => g.id === dragId);
      const toIndex = items.findIndex((g) => g.id === overId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);

      return recomputeActiveOrder(items);
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLTableRowElement>) => {
    e.preventDefault();
    setDragId(null);
  };

  // Reset urutan semua game ke default A–Z (berdasarkan nama)
  const handleResetOrder = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Reset semua urutan game aktif ke A–Z berdasarkan nama? (Berlaku untuk semua provider, bukan hanya filter yang sedang dipilih.)"
      )
    ) {
      return;
    }

    setGames((prev) => {
      const active = prev
        .filter((g) => g.is_active)
        .sort((a, b) => a.display_name.localeCompare(b.display_name));

      const inactive = prev
        .filter((g) => !g.is_active)
        .sort((a, b) => a.display_name.localeCompare(b.display_name));

      const merged = [...active, ...inactive];

      return recomputeActiveOrder(merged);
    });

    setSaveMessage(null);
    setErrorMessage(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/game-list-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          games: games.map((g) => ({
            id: g.id,
            slug: g.slug,
            display_name: g.display_name,
            provider: g.provider,
            is_active: g.is_active,
            display_order: g.display_order,
          })),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Gagal menyimpan");
      }

      setSaveMessage("Perubahan berhasil disimpan.");
    } catch (err: any) {
      setErrorMessage(err?.message ?? "Gagal menyimpan perubahan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <section className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-semibold mb-2">
          Pengaturan Daftar Game
        </h1>
        <p className="text-sm text-neutral-300 mb-4">
          Halaman ini mengatur game apa saja yang tampil di halaman
          utama dan urutannya. Game yang{" "}
          <strong>Aktif</strong> akan tampil. Urutan kartu
          mengikuti nilai <strong>display_order</strong> (kecil ke
          besar). Game aktif bisa di-drag untuk mengubah urutan, atau
          diatur dengan kolom Order + tombol <strong>Move</strong>.
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm">Filter Provider:</span>
            <select
              className="bg-neutral-900 border border-neutral-700 text-sm rounded px-2 py-1"
              value={providerFilter}
              onChange={(e) =>
                setProviderFilter(e.target.value as ProviderFilter)
              }
            >
              <option value="ALL">Semua</option>
              {PROVIDER_META.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <input
            type="text"
            placeholder="Cari nama game..."
            className="bg-neutral-900 border border-neutral-700 text-sm rounded px-2 py-1 min-w-[200px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {/* tombol di sisi kanan */}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetOrder}
              className="bg-neutral-800 hover:bg-neutral-700 text-xs sm:text-sm px-3 py-1.5 rounded border border-neutral-700"
            >
              Reset urutan (A–Z)
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-sm font-semibold px-4 py-1.5 rounded"
            >
              {saving ? "Menyimpan..." : "Simpan Perubahan"}
            </button>
          </div>
        </div>

        {saveMessage && (
          <div className="mb-3 text-sm text-emerald-400">
            {saveMessage}
          </div>
        )}
        {errorMessage && (
          <div className="mb-3 text-sm text-red-400">
            {errorMessage}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-900/80">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                <th className="w-16">
                  <div className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={allVisibleChecked}
                      onChange={(e) =>
                        handleToggleAllVisible(e.target.checked)
                      }
                    />
                    <span className="text-xs">Semua</span>
                  </div>
                </th>
                <th className="w-28">Provider</th>
                <th>Nama Game</th>
                <th className="w-28">Order</th>
                <th className="w-24 text-center">Move</th>
              </tr>
            </thead>
            <tbody>
              {visibleGames.map((g) => (
                <tr
                  key={g.id}
                  className="border-t border-neutral-800 hover:bg-neutral-900/70"
                  draggable={g.is_active}
                  onDragStart={() => handleDragStart(g.id)}
                  onDragOver={(e) => handleDragOver(e, g.id)}
                  onDrop={handleDrop}
                >
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={g.is_active}
                        onChange={(e) =>
                          handleToggleActive(g.id, e.target.checked)
                        }
                      />
                      {g.is_active && (
                        <span className="cursor-move text-xs text-neutral-400">
                          ⇅
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-1">
                      <span className="text-xs font-mono">
                        {g.provider}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={
                        g.is_active ? "" : "text-neutral-500 line-through"
                      }
                    >
                      {g.display_name}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number"
                      className="w-20 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-right"
                      value={g.display_order ?? ""}
                      onChange={(e) =>
                        handleOrderChange(g.id, e.target.value)
                      }
                    />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {g.is_active ? (
                      <button
                        type="button"
                        onClick={() => handleMove(g.id)}
                        className="text-xs px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
                      >
                        Move
                      </button>
                    ) : (
                      <span className="text-xs text-neutral-600">
                        –
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {visibleGames.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-4 text-center text-neutral-400"
                  >
                    Tidak ada game untuk filter yang dipilih.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-neutral-400">
          Tips: untuk mengatur urutan, aktifkan dulu game yang ingin
          tampil. Kamu bisa drag baris (ikon ⇅) atau isi kolom{" "}
          <strong>Order</strong> lalu klik tombol{" "}
          <strong>Move</strong> di baris tersebut. Urutan display akan
          otomatis dinomori ulang dari 1 untuk yang paling atas.
        </p>
      </section>
    </main>
  );
}

// helper: hitung ulang display_order untuk semua game aktif
// urutan array = urutan visual, tapi aktif selalu di bagian atas
function recomputeActiveOrder(
  games: GameConfigRow[]
): GameConfigRow[] {
  const active: GameConfigRow[] = [];
  const inactive: GameConfigRow[] = [];

  for (const g of games) {
    if (g.is_active) {
      active.push(g);
    } else {
      inactive.push(g);
    }
  }

  let order = 1;
  const activeWithOrder = active.map((g) => ({
    ...g,
    display_order: order++,
  }));

  const inactiveWithNull = inactive.map((g) => ({
    ...g,
    display_order: null,
  }));

  return [...activeWithOrder, ...inactiveWithNull];
}
