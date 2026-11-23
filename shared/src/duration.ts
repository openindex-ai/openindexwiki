/** `90`, `90s`, `15m`, `1h`, `2d` (or combined, `1h30m`) -> seconds; throws a readable Error. */
export function parseDuration(input: string): number {
  const s = input.trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  const re = /(\d+)\s*(d|h|m|s)/g;
  let total = 0;
  let consumed = 0;
  for (const m of s.matchAll(re)) {
    total += Number(m[1]) * { d: 86_400, h: 3600, m: 60, s: 1 }[m[2] as "d" | "h" | "m" | "s"];
    consumed += m[0].length;
  }
  if (consumed === 0 || consumed !== s.replace(/\s+/g, "").length) throw new Error(`Invalid duration "${input}": use e.g. 30s, 15m, 1h, 1h30m or a number of seconds`);
  return total;
}

/** 900 -> "15m", 5400 -> "1h30m", 45 -> "45s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return [d ? `${d}d` : "", h ? `${h}h` : "", m ? `${m}m` : "", rest ? `${rest}s` : ""].join("");
}
