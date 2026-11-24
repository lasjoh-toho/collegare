/**
 * Bilder im Arbeitsblatt bearbeiten (Wunsch Jo, 24. November 2026): zuschneiden, freistellen, verkleinern.
 * Alles geschieht im Browser auf einer Leinwand; das Ergebnis ist ein neues Bild (data-URL). Das Original bleibt im
 * Baustein (orig), damit „Original wiederherstellen“ alles zurücknimmt.
 */

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Das Bild ließ sich nicht lesen.'));
    i.src = src;
  });
}

/** Bild mit seiner Drehung (0, 90, 180, 270) auf eine Leinwand zeichnen */
async function rotated(src: string, rot: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(src);
  const r = (((rot || 0) % 360) + 360) % 360;
  const side = r % 180 !== 0;
  const c = document.createElement('canvas');
  c.width = side ? img.naturalHeight : img.naturalWidth;
  c.height = side ? img.naturalWidth : img.naturalHeight;
  const g = c.getContext('2d')!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((r * Math.PI) / 180);
  g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return c;
}

/** hat die Leinwand durchsichtige Stellen? */
function hasAlpha(c: HTMLCanvasElement): boolean {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 16) if (d[i] < 250) return true;
  return false;
}

function out(c: HTMLCanvasElement, quality = 0.85): { src: string; ar: number } {
  const src = hasAlpha(c) ? c.toDataURL('image/png') : jpeg(c, quality);
  return { src, ar: c.height / Math.max(1, c.width) };
}
function jpeg(c: HTMLCanvasElement, quality: number) {
  const w = document.createElement('canvas');
  w.width = c.width;
  w.height = c.height;
  const g = w.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w.width, w.height);
  g.drawImage(c, 0, 0);
  return w.toDataURL('image/jpeg', quality);
}

/** Zuschnitt als Anteile (0–1) vom Rand: links, oben, rechts, unten. Die Drehung wird dabei ins Bild übernommen. */
export type Crop = [number, number, number, number];
export async function cropImage(src: string, rot: number, crop: Crop): Promise<{ src: string; ar: number }> {
  const c = await rotated(src, rot);
  const [l, t, r, b] = crop;
  const x = Math.round(c.width * l);
  const y = Math.round(c.height * t);
  const w = Math.max(1, Math.round(c.width * (1 - l - r)));
  const h = Math.max(1, Math.round(c.height * (1 - t - b)));
  const o = document.createElement('canvas');
  o.width = w;
  o.height = h;
  o.getContext('2d')!.drawImage(c, x, y, w, h, 0, 0, w, h);
  return out(o);
}

/**
 * Freistellen: der Hintergrund, der vom Rand her zusammenhängt und der Randfarbe ähnelt, wird durchsichtig (Flutfüllung
 * von allen Randpunkten aus). Weiße Stellen im Inneren des Motivs bleiben so erhalten. tol: 10 (eng) bis 80 (weit).
 */
export async function removeBackground(src: string, rot: number, tol = 36): Promise<{ src: string; ar: number }> {
  const c = await rotated(src, rot);
  const g = c.getContext('2d')!;
  const im = g.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  const W = c.width;
  const H = c.height;
  // Farbe des Hintergrunds: Mittel der Randpunkte, die der häufigsten Randhelligkeit nahe sind
  const edge: number[] = [];
  for (let x = 0; x < W; x++) edge.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) edge.push(y * W, y * W + W - 1);
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (const p of edge) {
    sr += d[p * 4];
    sg += d[p * 4 + 1];
    sb += d[p * 4 + 2];
    n++;
  }
  const bg = [sr / n, sg / n, sb / n];
  const t2 = tol * tol * 3;
  const near = (p: number) => {
    const dr = d[p * 4] - bg[0];
    const dg = d[p * 4 + 1] - bg[1];
    const db = d[p * 4 + 2] - bg[2];
    return dr * dr + dg * dg + db * db <= t2;
  };
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  for (const p of edge) if (!seen[p] && near(p)) (seen[p] = 1), stack.push(p);
  while (stack.length) {
    const p = stack.pop()!;
    d[p * 4 + 3] = 0;
    const x = p % W;
    const y = (p - x) / W;
    const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
    for (const q of nb) if (q >= 0 && !seen[q] && ((seen[q] = 1), near(q))) stack.push(q);
  }
  // weicher Rand: Punkte neben entfernten halb durchsichtig
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (d[p * 4 + 3] === 0) continue;
      if (d[(p - 1) * 4 + 3] === 0 || d[(p + 1) * 4 + 3] === 0 || d[(p - W) * 4 + 3] === 0 || d[(p + W) * 4 + 3] === 0) d[p * 4 + 3] = 160;
    }
  g.putImageData(im, 0, 0);
  return { src: c.toDataURL('image/png'), ar: H / Math.max(1, W) };
}

/** Datei verkleinern: längste Seite auf maxPx, JPEG (oder PNG, wenn freigestellt) */
export async function shrinkImage(src: string, rot: number, maxPx: number, quality = 0.8): Promise<{ src: string; ar: number }> {
  const c = await rotated(src, rot);
  const k = Math.min(1, maxPx / Math.max(c.width, c.height));
  const o = document.createElement('canvas');
  o.width = Math.max(1, Math.round(c.width * k));
  o.height = Math.max(1, Math.round(c.height * k));
  const g = o.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, o.width, o.height);
  return out(o, quality);
}

/** Größe einer data-URL in Bytes (ungefähr) */
export function srcBytes(src?: string): number {
  if (!src) return 0;
  const i = src.indexOf(',');
  if (!src.startsWith('data:') || i < 0) return 0;
  return src.slice(0, i).includes(';base64') ? Math.round(((src.length - i - 1) * 3) / 4) : src.length - i - 1;
}
export function kb(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** CSS-Filter für Helligkeit, Kontrast und Graustufen */
export function imageFilter(b: { bright?: number; contrast?: number; gray?: boolean }): string {
  const f: string[] = [];
  if (b.bright) f.push(`brightness(${1 + b.bright / 100})`);
  if (b.contrast) f.push(`contrast(${1 + b.contrast / 100})`);
  if (b.gray) f.push('grayscale(1)');
  return f.join(' ');
}
