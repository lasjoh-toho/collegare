// Autogra.fi-Kern: zusätzliche Blatterkennung für den Scanner.
//
// Der alte Ansatz (correction.js) sucht die vier stärksten Geraden. Auf liniertem
// oder beschriebenem Papier sind das oft Zeilen statt Blattränder. Diese Erkennung
// nutzt die Regel aus der Anleitung („helles Papier auf dunkler Fläche“): Sie sucht
// die größte helle, fast farblose Fläche, schließt Schrift und Linien darin, und
// legt ein Viereck um ihren Umriss. Nur wenn das Ergebnis plausibel ist, ersetzt
// es die alte Erkennung; sonst läuft diese wie bisher.
(function () {
    'use strict';

    const SIZE = 320; // Arbeitsauflösung (längere Seite)

    function otsu(hist, total) {
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += i * hist[i];
        let sumB = 0, wB = 0, best = 0, t = 128;
        for (let i = 0; i < 256; i++) {
            wB += hist[i];
            if (!wB) continue;
            const wF = total - wB;
            if (!wF) break;
            sumB += i * hist[i];
            const mB = sumB / wB, mF = (sum - sumB) / wF;
            const v = wB * wF * (mB - mF) * (mB - mF);
            if (v > best) { best = v; t = i; }
        }
        return t;
    }

    // Morphologie auf Binärmaske (quadratisches Fenster, getrennt in x und y)
    function morph(src, w, h, r, dilate) {
        const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let v = dilate ? 0 : 1;
                for (let k = -r; k <= r; k++) {
                    const xx = Math.min(w - 1, Math.max(0, x + k));
                    const s = src[y * w + xx];
                    if (dilate ? s : !s) { v = dilate ? 1 : 0; break; }
                }
                tmp[y * w + x] = v;
            }
        }
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let v = dilate ? 0 : 1;
                for (let k = -r; k <= r; k++) {
                    const yy = Math.min(h - 1, Math.max(0, y + k));
                    const s = tmp[yy * w + x];
                    if (dilate ? s : !s) { v = dilate ? 1 : 0; break; }
                }
                out[y * w + x] = v;
            }
        }
        return out;
    }

    // Größte zusammenhängende Fläche; liefert Maske und Fläche
    function largestComponent(mask, w, h) {
        const label = new Int32Array(w * h);
        const stack = new Int32Array(w * h);
        let bestLabel = 0, bestSize = 0, next = 0;
        for (let i = 0; i < w * h; i++) {
            if (!mask[i] || label[i]) continue;
            next++;
            let sp = 0, size = 0;
            stack[sp++] = i;
            label[i] = next;
            while (sp) {
                const p = stack[--sp];
                size++;
                const x = p % w, y = (p - x) / w;
                if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
                if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
                if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
                if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
            }
            if (size > bestSize) { bestSize = size; bestLabel = next; }
        }
        const out = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) out[i] = label[i] === bestLabel ? 1 : 0;
        return { mask: out, area: bestSize };
    }

    function hull(points) {
        points.sort((a, b) => a.x - b.x || a.y - b.y);
        const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        const lower = [], upper = [];
        for (const p of points) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
            lower.push(p);
        }
        for (let i = points.length - 1; i >= 0; i--) {
            const p = points[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
            upper.push(p);
        }
        upper.pop(); lower.pop();
        return lower.concat(upper);
    }

    function quadArea(q) {
        let a = 0;
        for (let i = 0; i < 4; i++) {
            const p = q[i], n = q[(i + 1) % 4];
            a += p.x * n.y - n.x * p.y;
        }
        return Math.abs(a) / 2;
    }

    // Viereck mit größter Fläche aus Punkten der konvexen Hülle (Startwerte: Extrempunkte)
    function bestQuad(h) {
        const pick = (f) => h.reduce((b, p) => (f(p) > f(b) ? p : b), h[0]);
        let q = [pick((p) => -p.x - p.y), pick((p) => p.x - p.y), pick((p) => p.x + p.y), pick((p) => -p.x + p.y)];
        for (let iter = 0; iter < 4; iter++) {
            let changed = false;
            for (let k = 0; k < 4; k++) {
                let best = quadArea(q), bestP = q[k];
                for (const p of h) {
                    const t = q.slice(); t[k] = p;
                    const a = quadArea(t);
                    if (a > best + 1e-6) { best = a; bestP = p; }
                }
                if (bestP !== q[k]) { q[k] = bestP; changed = true; }
            }
            if (!changed) break;
        }
        return q;
    }

    function convex(q) {
        let sign = 0;
        for (let i = 0; i < 4; i++) {
            const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
            const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
            if (Math.abs(z) < 1e-6) return false;
            if (sign && Math.sign(z) !== sign) return false;
            sign = Math.sign(z);
        }
        return true;
    }

    // Reihenfolge: oben links, oben rechts, unten rechts, unten links
    function order(q) {
        const cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4;
        const s = q.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
        // atan2 sortiert ab links (−π); oben links ist der Punkt mit kleinster x+y
        let start = 0;
        for (let i = 1; i < 4; i++) if (s[i].x + s[i].y < s[start].x + s[start].y) start = i;
        return [0, 1, 2, 3].map((i) => s[(start + i) % 4]);
    }

    /**
     * @param {ImageData} imageData
     * @returns {{corners: {x:number,y:number}[], confidence:number} | null}
     */
    function detectPaperQuad(imageData) {
        const W = imageData.width, H = imageData.height;
        const scale = Math.min(1, SIZE / Math.max(W, H));
        const w = Math.max(16, Math.round(W * scale)), h = Math.max(16, Math.round(H * scale));
        const src = imageData.data;
        // „Weißheit“: kleinster Farbkanal, gedämpft durch Sättigung (Holz, farbige Tische)
        const white = new Uint8Array(w * h);
        const hist = new Uint32Array(256);
        for (let y = 0; y < h; y++) {
            const sy = Math.min(H - 1, Math.floor(y / scale));
            for (let x = 0; x < w; x++) {
                const sx = Math.min(W - 1, Math.floor(x / scale));
                const i = (sy * W + sx) * 4;
                const r = src[i], g = src[i + 1], b = src[i + 2];
                const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
                const v = Math.max(0, Math.round(mn - 0.5 * (mx - mn)));
                white[y * w + x] = v;
                hist[v]++;
            }
        }
        const t = otsu(hist, w * h);
        let mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) mask[i] = white[i] > t ? 1 : 0;
        // Schrift und Linien schließen, dünne Brücken zum Hintergrund trennen
        mask = morph(morph(mask, w, h, 3, true), w, h, 3, false);
        mask = morph(morph(mask, w, h, 2, false), w, h, 2, true);
        const comp = largestComponent(mask, w, h);
        const frac = comp.area / (w * h);
        if (frac < 0.12 || frac > 0.97) return null;

        const pts = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                if (!comp.mask[i]) continue;
                if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !comp.mask[i - 1] || !comp.mask[i + 1] || !comp.mask[i - w] || !comp.mask[i + w]) {
                    pts.push({ x: x + 0.5, y: y + 0.5 });
                }
            }
        }
        const hl = hull(pts);
        if (hl.length < 4) return null;
        const q = order(bestQuad(hl));
        if (!convex(q)) return null;

        // Plausibilität: Viereck deckt die Fläche gut ab, Seitenverhältnis papierähnlich,
        // Blatt hebt sich deutlich vom Hintergrund ab.
        const qa = quadArea(q);
        const fill = comp.area / qa;
        const side = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const wq = (side(q[0], q[1]) + side(q[3], q[2])) / 2, hq = (side(q[0], q[3]) + side(q[1], q[2])) / 2;
        const ratio = Math.max(wq, hq) / Math.min(wq, hq);
        let inside = 0, outside = 0, ni = 0, no = 0;
        for (let i = 0; i < w * h; i++) {
            if (comp.mask[i]) { inside += white[i]; ni++; } else { outside += white[i]; no++; }
        }
        const contrast = no ? inside / ni - outside / no : 0;
        if (fill < 0.9 || fill > 1.06 || ratio > 2.2 || contrast < 25) return null;
        // Ecken, die am Bildrand kleben, sind meist abgeschnittene Blätter: geringere Sicherheit
        const atEdge = q.filter((p) => p.x < 2 || p.y < 2 || p.x > w - 2 || p.y > h - 2).length;
        const confidence = Math.max(0, Math.min(1, (fill - 0.9) * 5)) * 0.4 + Math.min(1, contrast / 80) * 0.4 + (atEdge ? 0 : 0.2);

        return {
            corners: q.map((p) => ({
                x: Math.round(Math.max(0, Math.min(W, p.x / scale))),
                y: Math.round(Math.max(0, Math.min(H, p.y / scale))),
            })),
            confidence,
        };
    }


    // ── Bewertung und Verfeinerung von Kandidaten ───────────────────────────
    // Ein Blattrand ist dort, wo es nach innen hell und nach außen dunkler wird.
    // Für jede Seite eines Vierecks wird gezählt, an wie vielen Stellen das
    // zutrifft. Gitterlinien auf kariertem Papier oder Tischkanten erfüllen das nicht.

    function whiteness(imageData) {
        const W = imageData.width, H = imageData.height, d = imageData.data;
        const raw = new Float32Array(W * H);
        for (let i = 0, j = 0; i < W * H; i++, j += 4) {
            const r = d[j], g = d[j + 1], b = d[j + 2];
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            raw[i] = Math.max(0, mn - 0.5 * (mx - mn));
        }
        // 3x3-Mittelwert gegen Rauschen
        const out = new Float32Array(W * H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                let s = 0, n = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    const yy = y + dy;
                    if (yy < 0 || yy >= H) continue;
                    for (let dx = -1; dx <= 1; dx++) {
                        const xx = x + dx;
                        if (xx < 0 || xx >= W) continue;
                        s += raw[yy * W + xx]; n++;
                    }
                }
                out[y * W + x] = s / n;
            }
        }
        return { w: W, h: H, v: out };
    }

    function at(img, x, y) {
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= img.w || yi >= img.h) return null;
        return img.v[yi * img.w + xi];
    }

    // Helligkeitssprung an Punkt p in Richtung der Außennormale n
    function step(img, p, n, reach) {
        let a = 0, b = 0, na = 0, nb = 0;
        for (let d = 2; d <= reach; d++) {
            const i = at(img, p.x - n.x * d, p.y - n.y * d);
            const o = at(img, p.x + n.x * d, p.y + n.y * d);
            if (i !== null) { a += i; na++; }
            if (o !== null) { b += o; nb++; }
        }
        if (!na) return -999;
        // Außerhalb des Bildes: Rand gilt als möglich, aber nicht als Beleg
        if (!nb) return 0;
        return a / na - b / nb;
    }

    function sideGeometry(q, k) {
        const a = q[k], b = q[(k + 1) % 4];
        const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        let n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if ((mx - cx) * n.x + (my - cy) * n.y < 0) n = { x: -n.x, y: -n.y };
        return { a, b, n, len };
    }

    const MIN_STEP = 7;

    function support(img, q) {
        const reach = Math.max(3, Math.round(Math.min(img.w, img.h) / 100));
        const sides = [];
        let strength = 0, count = 0;
        for (let k = 0; k < 4; k++) {
            const { a, b, n } = sideGeometry(q, k);
            let ok = 0, total = 0;
            for (let i = 1; i < 30; i++) {
                const t = 0.08 + 0.84 * i / 30;
                const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
                let best = -999;
                for (let o = -2; o <= 2; o++) best = Math.max(best, step(img, { x: p.x + n.x * o, y: p.y + n.y * o }, n, reach + 2));
                if (best === -999) continue;
                total++;
                if (best >= MIN_STEP || best === 0) ok++;
                // Genauigkeit: Sprung direkt auf der Linie, ohne Suchspielraum
                strength += Math.max(0, Math.min(step(img, p, n, 3), 80));
            }
            sides.push(total ? ok / total : 0);
            count += total;
        }
        // Anteil belegter Randpunkte; bei Gleichstand gewinnt der deutlichere Rand
        return 0.6 * Math.min(...sides) + 0.4 * sides.reduce((s, v) => s + v, 0) / 4 + 0.002 * strength / Math.max(1, count);
    }

    function fitLine(pts) {
        const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length, my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        let sxx = 0, syy = 0, sxy = 0;
        for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
        const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        return { p: { x: mx, y: my }, d: { x: Math.cos(ang), y: Math.sin(ang) } };
    }

    function intersect(l1, l2) {
        const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
        if (Math.abs(den) < 1e-9) return null;
        const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
        return { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
    }

    // Jede Seite an den stärksten Hell-dunkel-Sprung in der Nähe schieben, Ecken neu schneiden
    function refine(img, q, radius) {
        const reach = Math.max(3, Math.round(Math.min(img.w, img.h) / 100));
        const lines = [];
        for (let k = 0; k < 4; k++) {
            const { a, b, n } = sideGeometry(q, k);
            const pts = [];
            for (let i = 1; i < 40; i++) {
                const t = 0.06 + 0.88 * i / 40;
                const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
                let best = -999, bo = 0;
                for (let o = -radius; o <= radius; o++) {
                    const s = step(img, { x: p.x + n.x * o, y: p.y + n.y * o }, n, reach);
                    if (s > best) { best = s; bo = o; }
                }
                if (best >= MIN_STEP) pts.push({ x: p.x + n.x * bo, y: p.y + n.y * bo });
            }
            let line = { p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: { x: (b.x - a.x), y: (b.y - a.y) } };
            if (pts.length >= 8) {
                line = fitLine(pts);
                // Ausreißer (Schrift, Schatten) verwerfen und neu anpassen
                const dist = (p) => Math.abs((p.x - line.p.x) * line.d.y - (p.y - line.p.y) * line.d.x);
                const keep = pts.filter((p) => dist(p) <= 1.5);
                if (keep.length >= 6) line = fitLine(keep);
            }
            lines.push(line);
        }
        const out = [];
        for (let k = 0; k < 4; k++) {
            const c = intersect(lines[(k + 3) % 4], lines[k]);
            if (!c) return q;
            out.push(c);
        }
        // Verfeinerung darf das Viereck nicht stark verändern
        for (let k = 0; k < 4; k++) if (Math.hypot(out[k].x - q[k].x, out[k].y - q[k].y) > radius * 2.5) return q;
        return convex(out) ? out : q;
    }

    // Kandidat aus Kanten: Hintergrund vom Bildrand aus fluten, Kanten halten auf
    function edgeFloodQuad(imageData) {
        const W = imageData.width, H = imageData.height;
        const scale = Math.min(1, SIZE / Math.max(W, H));
        const w = Math.round(W * scale), h = Math.round(H * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        const src = document.createElement('canvas');
        src.width = W; src.height = H;
        src.getContext('2d').putImageData(imageData, 0, 0);
        ctx.drawImage(src, 0, 0, w, h);
        const img = whiteness(ctx.getImageData(0, 0, w, h));
        const g = new Float32Array(w * h);
        const vals = [];
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const i = y * w + x, v = img.v;
                const gx = v[i + 1] - v[i - 1], gy = v[i + w] - v[i - w];
                g[i] = Math.hypot(gx, gy);
                vals.push(g[i]);
            }
        }
        vals.sort((a, b) => a - b);
        const thr = Math.max(8, vals[Math.floor(vals.length * 0.9)]);
        let edge = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) edge[i] = g[i] >= thr ? 1 : 0;
        edge = morph(edge, w, h, 1, true);
        const outside = new Uint8Array(w * h), stack = [];
        for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
        for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
        while (stack.length) {
            const p = stack.pop();
            if (outside[p] || edge[p]) continue;
            outside[p] = 1;
            const x = p % w;
            if (x > 0) stack.push(p - 1);
            if (x < w - 1) stack.push(p + 1);
            if (p >= w) stack.push(p - w);
            if (p < w * (h - 1)) stack.push(p + w);
        }
        let inside = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) inside[i] = outside[i] ? 0 : 1;
        inside = morph(morph(inside, w, h, 2, false), w, h, 2, true);
        const comp = largestComponent(inside, w, h);
        if (comp.area / (w * h) < 0.1) return null;
        const pts = [];
        for (let i = 0; i < w * h; i++) {
            if (!comp.mask[i]) continue;
            const x = i % w, y = (i - x) / w;
            if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !comp.mask[i - 1] || !comp.mask[i + 1] || !comp.mask[i - w] || !comp.mask[i + w]) pts.push({ x: x + 0.5, y: y + 0.5 });
        }
        const hl = hull(pts);
        if (hl.length < 4) return null;
        const q = order(bestQuad(hl));
        if (!convex(q)) return null;
        return q.map((p) => ({ x: p.x / scale, y: p.y / scale }));
    }

    function plausible(q, W, H) {
        if (!q || q.length !== 4 || !convex(q)) return false;
        const a = quadArea(q) / (W * H);
        if (a < 0.08 || a > 1.02) return false;
        const side = (u, v) => Math.hypot(u.x - v.x, u.y - v.y);
        const wq = (side(q[0], q[1]) + side(q[3], q[2])) / 2, hq = (side(q[0], q[3]) + side(q[1], q[2])) / 2;
        return Math.max(wq, hq) / Math.min(wq, hq) < 2.5;
    }

    /**
     * Beste Ecken aus allen Kandidaten (alte Erkennung, Helligkeit, Kanten).
     * @param {ImageData} imageData
     * @param {{x:number,y:number}[]|null} oldCorners Ergebnis der alten Erkennung
     * @returns {{corners:{x:number,y:number}[], score:number, source:string}|null}
     */
    function bestPaperCorners(imageData, oldCorners) {
        const W = imageData.width, H = imageData.height;
        const img = whiteness(imageData);
        const cands = [];
        if (oldCorners && oldCorners.length === 4) cands.push({ q: order(oldCorners.map((p) => ({ x: p.x, y: p.y }))), source: 'linien' });
        try { const b = detectPaperQuad(imageData); if (b) cands.push({ q: b.corners, source: 'helligkeit' }); } catch (e) { /* weiter */ }
        try { const e = edgeFloodQuad(imageData); if (e) cands.push({ q: e, source: 'kanten' }); } catch (e) { /* weiter */ }
        const radius = Math.max(4, Math.round(Math.min(W, H) / 40));
        let best = null;
        for (const c of cands) {
            if (!plausible(c.q, W, H)) continue;
            const r = refine(img, refine(img, c.q, radius), Math.max(2, radius >> 1));
            for (const q of [c.q, r]) {
                if (!plausible(q, W, H)) continue;
                const s = support(img, q) + 0.002 * quadArea(q) / (W * H); // bei Gleichstand das größere Blatt
                if (!best || s > best.score) best = { corners: q, score: s, source: c.source + (q === r ? '+fein' : '') };
            }
        }
        if (!best || best.score < 0.55) return null;
        best.corners = best.corners.map((p) => ({ x: Math.round(Math.max(0, Math.min(W, p.x))), y: Math.round(Math.max(0, Math.min(H, p.y))) }));
        return best;
    }

    window.bestPaperCorners = bestPaperCorners;
    window.detectPaperQuad = detectPaperQuad;
})();
