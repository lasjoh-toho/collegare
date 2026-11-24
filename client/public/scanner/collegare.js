// Ziel des Scanners in Collegare. Ersetzt device.js aus Autogra.fi (QR-Kopplung) mit derselben Schnittstelle für
// main.js (window.AutografiDevice.upload / showDone). Der Scanner läuft in einem iframe von „Notizen und Quellen“;
// die Bilder gehen als JPEG-Blobs per postMessage an die Seite, die ihn geöffnet hat (gleicher Ursprung).
// Aufruf: scanner/index.html?max=1
(function () {
    'use strict';
    const q = new URLSearchParams(location.search);
    const max = Math.max(1, Math.min(10, Number(q.get('max')) || 1));
    // Bild bleibt in Farbe: aufbereitet wird erst vor der Texterkennung (options.js liest das)
    // format 'frei': Seitenverhältnis aus den Ecken statt A4 (correction.js)
    window.SCANNER_ZIEL = { maxSeiten: max, dokumentfilter: false, format: 'frei' };
    const $ = (id) => document.getElementById(id);
    const parentWin = window.parent !== window ? window.parent : window.opener;
    const send = (msg) => parentWin && parentWin.postMessage(msg, location.origin);

    function toJpeg(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0);
                c.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht umgewandelt werden'))), 'image/jpeg', 0.9);
            };
            img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
            img.src = dataUrl;
        });
    }

    async function upload(images, progress) {
        if (!parentWin) throw new Error('Bitte den Scanner aus „Notizen und Quellen“ öffnen.');
        if (images.length > max) throw new Error(max === 1 ? 'Bitte nur ein Bild auswählen (Haken bei den anderen entfernen).' : 'Höchstens ' + max + ' Bilder.');
        const blobs = [];
        for (let i = 0; i < images.length; i++) {
            blobs.push(await toJpeg(images[i]));
            progress(i + 1, images.length);
        }
        send({ type: 'collegare-scan', images: blobs });
    }

    // Die Notiz schließt den Scanner selbst; hier nur für den Fall, dass er allein geöffnet wurde
    function showDone(count) {
        $('doneTitle').textContent = count === 1 ? 'Bild übernommen' : count + ' Bilder übernommen';
        $('doneOverlay').hidden = false;
    }

    document.addEventListener('DOMContentLoaded', () => {
        $('doneMoreBtn').addEventListener('click', () => { $('doneOverlay').hidden = true; });
        $('closeBtn').addEventListener('click', () => (parentWin ? send({ type: 'collegare-scan-close' }) : window.close()));
        // am Handy gleich die Kamera öffnen (am Rechner erst auf Knopfdruck, oft gibt es dort keine)
        if (q.get('kamera') === '1' && matchMedia('(pointer: coarse)').matches) setTimeout(() => window.showCamera && window.showCamera(), 0);
        if (max > 1) $('targetHint').textContent = 'Bis zu ' + max + ' Bilder, in der richtigen Reihenfolge';
    });

    window.AutografiDevice = { upload, showDone };
})();
