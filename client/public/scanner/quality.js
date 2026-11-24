// Autogra.fi-Kern: Qualitätsprüfung der aufgenommenen Seiten.
//
// Neu gegenüber dem alten Scanner. Nach dem Entzerren wird jede Seite auf
// Unschärfe, zu wenig Licht und zu geringe Auflösung geprüft. Bei einem Problem
// erscheint ein Hinweis mit „Neu aufnehmen“ oder „Trotzdem verwenden“, und die
// Seite trägt ein Warnzeichen. Hochladen bleibt immer möglich: die Prüfung irrt
// sich manchmal, und die Entscheidung liegt bei der Person.
(function () {
    'use strict';

    const WORK = 500;          // Prüfbreite in Pixeln (Schrift bleibt lesbar, Rauschen fällt weg)
    const SHARP_MIN = 0.70;    // darunter: unscharf (kalibriert an Testseiten, siehe README)
    const DARK_MAX = 95;       // mittlere Papierhelligkeit darunter: zu dunkel
    const MIN_WIDTH = 700;     // entzerrte Seite schmaler: zu weit weg oder zu klein

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    /**
     * @param {string} src Bild als data:-URL
     * @returns {Promise<{sharpness:number, brightness:number, width:number, issues:string[]}>}
     */
    async function analyzePage(src) {
        const img = await loadImage(src);
        const s = Math.min(1, WORK / img.naturalWidth);
        const w = Math.max(32, Math.round(img.naturalWidth * s)), h = Math.max(32, Math.round(img.naturalHeight * s));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        const g = new Float32Array(w * h);
        const hist = new Uint32Array(256);
        for (let i = 0, j = 0; i < w * h; i++, j += 4) {
            const v = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
            g[i] = v;
            hist[v | 0]++;
        }
        const pct = (p) => {
            let acc = 0;
            const target = p * w * h;
            for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
            return 255;
        };
        const paper = pct(0.7);                 // typische Papierhelligkeit
        // Unschärfe nach Crété-Roffet u. a. (2007): Das Bild wird absichtlich
        // weichgezeichnet. Ein scharfes Bild verliert dabei viel Unterschied zwischen
        // Nachbarpixeln, ein schon unscharfes kaum. Gemessen nur in Zeilen und Spalten
        // mit Schrift, damit leeres Papier das Ergebnis nicht verwässert.
        const m = Math.max(3, Math.round(Math.min(w, h) * 0.04)); // Rand (Schatten, Blattkante) auslassen
        const R = 4;
        let sF = [0, 0], sV = [0, 0];
        for (let dir = 0; dir < 2; dir++) {
            const outer = dir ? w : h, inner = dir ? h : w;
            for (let o = m; o < outer - m; o++) {
                const at = (k) => (dir ? g[k * w + o] : g[o * w + k]);
                let acc = 0;
                const box = new Float32Array(inner);
                for (let k = 0; k < inner; k++) {
                    acc += at(k);
                    if (k >= 2 * R + 1) acc -= at(k - 2 * R - 1);
                    if (k >= 2 * R) box[k - R] = acc / (2 * R + 1);
                }
                for (let k = m + 1; k < inner - m; k++) {
                    const dF = Math.abs(at(k) - at(k - 1));
                    if (dF < 4) continue; // Rauschen auf leerem Papier
                    const dB = Math.abs(box[k] - box[k - 1]);
                    sF[dir] += dF;
                    sV[dir] += Math.max(0, dF - dB);
                }
            }
        }
        const blur = Math.max(sF[0] ? 1 - sV[0] / sF[0] : 0, sF[1] ? 1 - sV[1] / sF[1] : 0);
        const sharpness = 1 - blur;
        const inked = paper - pct(0.02) > 40;   // genug Schrift für eine Aussage

        const issues = [];
        if (inked && sharpness < SHARP_MIN) issues.push('unscharf');
        if (paper < DARK_MAX) issues.push('dunkel');
        if (img.naturalWidth < MIN_WIDTH && img.naturalHeight < MIN_WIDTH * 1.4) issues.push('klein');
        return { sharpness, brightness: paper, width: img.naturalWidth, issues };
    }

    const TEXT = {
        unscharf: 'Das Foto wirkt unscharf. Halte das Handy ruhig und tippe vor dem Auslösen auf das Blatt, damit die Kamera scharf stellt.',
        dunkel: 'Das Foto ist sehr dunkel. Mehr Licht hilft, zum Beispiel am Fenster oder mit der Licht-Taste der Kamera.',
        klein: 'Das Blatt ist im Bild sehr klein. Geh näher heran, bis es das Bild fast ausfüllt.',
    };

    function describe(issues) {
        return issues.map((k) => TEXT[k]).filter(Boolean).join(' ');
    }

    let pending = null; // Prüfung der zuletzt entzerrten Aufnahme

    function banner() {
        let b = document.getElementById('qualityBanner');
        if (b) return b;
        b = document.createElement('div');
        b.id = 'qualityBanner';
        b.className = 'ag-quality';
        b.setAttribute('role', 'alert');
        b.hidden = true;
        b.innerHTML = '<p id="qualityText"></p><div class="ag-quality-actions">'
            + '<button type="button" id="qualityRetake" class="ag-quality-btn">Neu aufnehmen</button>'
            + '<button type="button" id="qualityKeep" class="ag-quality-btn ag-quality-keep">Trotzdem verwenden</button></div>';
        document.getElementById('optionsOverlay').appendChild(b);
        b.querySelector('#qualityKeep').addEventListener('click', () => { b.hidden = true; });
        b.querySelector('#qualityRetake').addEventListener('click', () => {
            b.hidden = true;
            pending = null;
            document.getElementById('optionsOverlay').style.display = 'none';
            if (typeof window.showCamera === 'function') window.showCamera();
        });
        return b;
    }

    function markThumbnail(t, issues) {
        if (!t) return;
        t.dataset.issues = issues.join(',');
        t.querySelector('.ag-quality-badge')?.remove();
        if (!issues.length) return;
        const badge = document.createElement('span');
        badge.className = 'ag-quality-badge';
        badge.title = describe(issues);
        badge.textContent = '!';
        t.appendChild(badge);
    }

    /** Vor dem Hochladen: bei Warnungen einmal nachfragen. */
    function confirmUpload(thumbnails) {
        const n = thumbnails.filter((t) => t.dataset.issues).length;
        if (!n) return true;
        return window.confirm((n === 1 ? '1 Seite ist' : n + ' Seiten sind')
            + ' möglicherweise schlecht lesbar (mit ! markiert). Trotzdem hochladen?');
    }

    document.addEventListener('DOMContentLoaded', () => {
        const showOptions = window.showOptions, addThumbnail = window.addThumbnail;
        if (typeof showOptions !== 'function' || typeof addThumbnail !== 'function') return;
        window.showOptions = function (src, el) {
            const isNew = !el || !el.isConnected;
            const b = banner();
            b.hidden = true;
            if (isNew) {
                pending = analyzePage(src).catch(() => ({ issues: [] }));
                pending.then((r) => {
                    if (!r.issues.length) return;
                    document.getElementById('qualityText').textContent = describe(r.issues);
                    b.hidden = false;
                });
            } else {
                pending = null; // Bearbeitung einer vorhandenen Seite: Prüfung bleibt
            }
            return showOptions.apply(this, arguments);
        };
        window.addThumbnail = async function (src) {
            const own = pending;
            pending = null;
            const t = await addThumbnail.apply(this, arguments);
            banner().hidden = true;
            if (own) markThumbnail(t, (await own).issues);
            return t;
        };
    });

    window.analyzePage = analyzePage;
    window.AutografiQuality = { confirmUpload };
})();
