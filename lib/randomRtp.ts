// lib/randomRtp.ts

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

// Sekarang kita pakai 1 nilai RTP saja.
// Contoh range 70–98% (boleh kamu ubah kalau mau lebih tinggi/rendah).
export function generateRtpRange() {
  const raw = randomBetween(70, 98);
  const value = Math.round(raw * 100) / 100; // 2 angka di belakang koma

  // rtp_min & rtp_max kita isi sama,
  // biar kompatibel dengan struktur table yang sudah ada.
  return {
    rtp_min: value,
    rtp_max: value
  };
}

// Durasi random 1–2 jam tetap sama
export function generateWindow(startFrom: Date) {
  const hours = randomBetween(1, 2);
  const durationMs = hours * 60 * 60 * 1000;

  const window_start = startFrom;
  const window_end = new Date(startFrom.getTime() + durationMs);

  return { window_start, window_end };
}
