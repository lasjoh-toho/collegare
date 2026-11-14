/**
 * Seite der eigenständigen Präsentation, wörtlich aus export_presentation.php von mod_pinnwand übernommen
 * (gleiche Lizenz wie der Kern), damit Export in Moodle und Collegare gleich aussehen und sich gleich bedienen.
 * Beim Wechsel des Stands von mod_pinnwand (scripts/pinnwand.ref) mit dem Original vergleichen.
 */
export const exportHtml = (title: string, json: string, player: string) => `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:#2b2d33;overflow:hidden;height:100%;font-family:sans-serif;}
  #bg{position:absolute;z-index:0;}
  #bg.moves{left:0;top:0;width:1400px;height:1000px;}
  #bg-image{position:absolute;left:0;top:0;width:1400px;height:1000px;background-repeat:no-repeat;background-position:center;}
  .ph{position:absolute;transition:opacity .2s;}
  .ph img{width:100%;display:block;border-radius:4px;box-shadow:0 4px 24px rgba(0,0,0,.5);}
  .ph.wordart img{border-radius:0;box-shadow:none;}
  /* Wortfeld mit bekannter Kartengröße/viewBox: .ph ist exakt die Karte
     (wie auf der Pinnwand, dreht sich auch um deren Mitte), das Bild
     ragt so weit darüber hinaus, wie seine viewBox es vorgibt. */
  .ph.wordfield-mapped img{position:absolute;max-width:none;}
</style>
</head>
<body>
<div id="player"></div>
<script type="application/json" id="pinnwand-export-data">
${json}
</script>
<script>
${player}
</script>
<script>
(function(){
  var data = JSON.parse(document.getElementById('pinnwand-export-data').textContent);
  var BW = data.boardWidth || 1400, BH = data.boardHeight || 1000;
  // Rand je Seite beim Heranzoomen an eine Station - identisch mit
  // PRESENT_STEP_MARGIN in app.js (Live-Präsentation).
  var STEP_MARGIN = 0.05;
  var player = PinnwandPresentation.create(document.getElementById('player'), { labels: data.labels || {} });
  var stage = player.stage;
  var canvas = player.canvas;

  // Hintergrund (Farbe/Bild) - dieselbe Logik wie applyBackground() im
  // Plugin: äußeres Element trägt die reine Farbe (auch als "Letterbox" um
  // ein im "contain"-Modus eingepasstes Bild herum), inneres Element
  // (exakt 1400x1000, dasselbe Koordinatensystem wie die Fotos) trägt das
  // eigentliche Bild. "bgmoves" entscheidet, ob der Hintergrund Teil der
  // gezoomten Leinwand ist oder bildschirmfüllend fest steht.
  var bg = data.background || { type: 'color', color: '#2b2d33' };
  // Farbe zusätzlich direkt auf body, damit sie in JEDEM Fall sichtbar
  // bleibt (auch wenn Farbe UND Bild zusammen gewählt sind).
  document.body.style.backgroundColor = bg.color || '#2b2d33';
  var bgEl = document.createElement('div');
  bgEl.id = 'bg';
  bgEl.style.backgroundColor = bg.color || '#2b2d33';
  var bgImage = document.createElement('div');
  bgImage.id = 'bg-image';
  bgEl.appendChild(bgImage);
  bgImage.style.backgroundColor = bg.color || '#2b2d33';
  if ((bg.type === 'image' || bg.type === 'url' || bg.type === 'upload') && bg.url) {
    bgImage.style.backgroundImage = "url('" + bg.url + "')";
    bgImage.style.backgroundSize = bg.fit === 'cover' ? 'cover' : 'contain';
  }
  var bgFx = null;
  try { bgFx = bg.fx ? JSON.parse(bg.fx) : null; } catch (e) { bgFx = null; }
  var bgBrightness = (bg.brightness != null ? bg.brightness : 100);
  var bgSaturation = (bg.saturation != null ? bg.saturation : 100);
  var bgInvert = (bg.invert != null ? bg.invert : 0);
  var bgFilter = 'brightness(' + bgBrightness + '%) saturate(' + bgSaturation + '%)' + (bgInvert ? ' invert(' + bgInvert + '%)' : '');
  var bgAnchored = !!(data.thread && data.thread.bgmoves);
  if (bgFx && bgFx.fill &&
      PinnwandPresentation.applyFxFill(bgEl, bg, bgFx.fill, bgFilter, bgAnchored)) {
    // Verlauf/Grainy Mesh liegt auf der ganzen Fläche samt Effekten (am Board
    // verankert und darüber hinaus, wenn der Hintergrund mitzoomt).
    if (bgImage.style.backgroundImage) {
      bgImage.style.backgroundColor = 'transparent';
      bgImage.style.filter = bgFilter + (bgFx.blur ? ' blur(' + bgFx.blur + 'px)' : '');
    } else {
      bgImage.style.background = 'none';
    }
  } else {
    bgImage.style.filter = bgFilter + (bgFx && bgFx.blur ? ' blur(' + bgFx.blur + 'px)' : '');
  }
  if (data.thread && data.thread.bgmoves) {
    bgEl.classList.add('moves');
    canvas.appendChild(bgEl);
  } else {
    player.setScreenLayer(bgEl);
  }

  // Alle Board-Objekte als feste Ebene (Positionen exakt wie auf dem
  // Board) - nicht nur die Stationen selbst.
  var photoRecs = {};
  var occludables = [];
  var hasAnnot = false;
  var inkForOverview = null;
  (data.boardPhotos || []).forEach(function (p) {
    if (!p) { return; }
    var pel = document.createElement('div');
    pel.className = 'ph' + (p.iswordart ? ' wordart' : '');
    pel.style.left = p.canvasx + 'px';
    pel.style.top = p.canvasy + 'px';
    pel.style.width = p.canvasw + 'px';
    pel.style.transform = 'rotate(' + (p.canvasrot || 0) + 'deg)';
    pel.style.zIndex = p.canvasz || 0;
    if (p.blendmode === 'invert') { pel.style.filter = 'invert(1)'; } else if (p.blendmode) { pel.style.mixBlendMode = p.blendmode; }
    var img = document.createElement('img');
    img.src = p.url; img.alt = '';
    // Folie mit Animationsschritten: SVG direkt einbetten statt als Bild,
    // damit die Abspiel-Logik einzelne Objekte (data-pwp-build) ein- und
    // ausblenden kann.
    if (p.animsteps && p.url.indexOf('data:image/svg+xml;base64,') === 0) {
      try {
        var svgText = decodeURIComponent(escape(atob(p.url.slice(26))));
        var holder = document.createElement('div');
        holder.innerHTML = svgText;
        var svgEl = holder.querySelector('svg');
        if (svgEl) { img = svgEl; img.style.display = 'block'; }
      } catch (e) { /* Bild bleibt */ }
    }
    var rec = { el: pel, z: p.canvasz || 0, img: img, photo: p, box: null };
    if (p.tfw && p.tfh && p.vb) {
      // Karte (tf.w x tf.h) liegt exakt auf canvasx/canvasy/canvasw - wie
      // auf der Pinnwand; das SVG wird gemäß seiner viewBox darum herum
      // platziert, statt auf Kartenbreite zusammengestaucht zu werden.
      var k = p.canvasw / p.tfw;
      pel.classList.add('wordfield-mapped');
      pel.style.height = (p.tfh * k) + 'px';
      img.style.left = (p.vb[0] * k) + 'px';
      img.style.top = (p.vb[1] * k) + 'px';
      img.style.width = (p.vb[2] * k) + 'px';
      if (img.tagName.toLowerCase() === 'svg') {
        img.style.position = 'absolute';
        img.style.height = (p.vb[3] * k) + 'px';
      }
      // Zoom-Ziel: bei WordArt der ganze sichtbare Bereich (viewBox), bei
      // normalen Zetteln die Karte selbst.
      rec.box = p.wordartframe
        ? { x: p.canvasx + p.vb[0] * k, y: p.canvasy + p.vb[1] * k, w: p.vb[2] * k, h: p.vb[3] * k }
        : { x: p.canvasx, y: p.canvasy, w: p.canvasw, h: p.tfh * k };
    }
    pel.appendChild(img);
    canvas.appendChild(pel);
    // Annotationen auf dem Objekt (nur falls beim Export gewählt).
    if (p.annotation && p.annotation.length) {
      PinnwandPresentation.attachInk(pel, p.annotation, 'annot');
      hasAnnot = true;
    }
    photoRecs[p.id] = rec;
    occludables.push(rec);
  });

  // Notizen des Stylus-Werkzeugs auf der Pinnwand - über allen Objekten,
  // wie in der Präsentation im Modul.
  if (hasAnnot) { player.addToggle('annot', (data.labels && data.labels.annot) || 'Annotationen'); }
  if (data.boardInk && data.boardInk.length) {
    canvas.appendChild(PinnwandPresentation.inkLayer(data.boardInk, BW, BH, 'ink', 600));
    player.addToggle('ink', (data.labels && data.labels.ink) || 'Notizen');
    inkForOverview = PinnwandPresentation.inkBounds(data.boardInk, BW, BH);
  }

  function overviewStep() {
    return { cx: BW / 2, cy: BH / 2, w: BW, h: BH, rot: 0, overview: true };
  }

  // Stationen (Fotos, Wortfelder, Rahmen als reine Zoom-Ziele, Überblick)
  // genau wie in der Live-Präsentation (buildStep in openPresentation()).
  var items = (data.thread && data.thread.items) || [];
  var steps = items.map(function (it) {
    if (it.itemtype === 'overview') { return overviewStep(); }
    if (it.itemtype === 'frame') {
      var fstep = {
        cx: it.framex + it.framew / 2, cy: it.framey + it.frameh / 2,
        w: it.framew, h: it.frameh, rot: -(it.framerot || 0), z: it.framez || 0, frame: true
      };
      // Folie: Inhalt (SVG) im Rahmen, gedreht wie der Rahmen, mit Ebene,
      // Mischmodus und Animationsschritten.
      if (it.framesvg) {
        var fel = document.createElement('div');
        fel.className = 'ph slide';
        fel.style.left = it.framex + 'px';
        fel.style.top = it.framey + 'px';
        fel.style.width = it.framew + 'px';
        fel.style.height = it.frameh + 'px';
        fel.style.transform = 'rotate(' + (it.framerot || 0) + 'deg)';
        fel.style.zIndex = it.framez || 0;
        if (it.blend === 'invert') { fel.style.filter = 'invert(1)'; } else if (it.blend) { fel.style.mixBlendMode = it.blend; }
        fel.innerHTML = it.framesvg;
        var sbcss = it.slidebg ? PinnwandPresentation.paintSlideBg(fel, it.slidebg) : null;
        var fsvg = fel.querySelector('svg');
        if (fsvg) { fsvg.style.width = '100%'; fsvg.style.height = '100%'; fsvg.style.display = 'block'; }
        canvas.appendChild(fel);
        occludables.push({ el: fel, z: it.framez || 0 });
        fstep.el = fel;
        if (it.animsteps) { fstep.buildEl = fel; fstep.buildCount = it.animsteps; }
        fstep.keep = (it.linked || []).map(function (pid) { return photoRecs[pid] && photoRecs[pid].el; }).filter(Boolean);
        fstep.slideEl = fel;
        fstep.slideBgHideBefore = !it.bgshowbefore;
        fstep.slideBgHideAfter = !it.bgpersist;
        fstep.slideElemHideBefore = !!it.elemhidebefore;
        fstep.slideElemHideAfter = !!it.elemhideafter;
        fstep.slideBgFull = sbcss && it.bgfull !== false ? it.slidebg : null;
      }
      return fstep;
    }
    if (!it.photo) { return null; }
    var rec = photoRecs[it.photo.id];
    if (!rec) { return null; }
    var p = rec.photo;
    if (rec.box) {
      return {
        el: rec.el, cx: rec.box.x + rec.box.w / 2, cy: rec.box.y + rec.box.h / 2,
        w: rec.box.w * (1 + 2 * STEP_MARGIN), h: rec.box.h * (1 + 2 * STEP_MARGIN),
        rot: 0, z: p.canvasz || 0, previewUrl: p.url,
        buildEl: p.animsteps ? rec.el : null, buildCount: p.animsteps || 0
      };
    }
    var natW = p.canvasw;
    var img2 = rec.img;
    var natH = img2.naturalWidth ? natW * (img2.naturalHeight / img2.naturalWidth) : natW * 0.75;
    var s = {
      el: rec.el, cx: p.canvasx + natW / 2, cy: p.canvasy + natH / 2,
      w: natW, h: natH, rot: 0, z: p.canvasz || 0, previewUrl: p.url
    };
    if (!img2.naturalWidth) {
      // Eingebettete Bilder werden asynchron dekodiert - das echte
      // Seitenverhältnis steht erst nach "load" fest.
      img2.addEventListener('load', function () {
        var h = natW * (img2.naturalHeight / img2.naturalWidth);
        s.h = h;
        s.cy = p.canvasy + h / 2;
        player.refreshStep(s);
      });
    }
    return s;
  }).filter(Boolean);

  // Präsentation startet immer mit einem Überblick über die ganze
  // Pinnwand (falls der Rote Faden nicht selbst schon damit beginnt).
  steps = PinnwandPresentation.expandBuildSteps(steps);
  if (steps.length && !steps[0].overview) { steps.unshift(overviewStep()); }
  player.start(steps, occludables, (data.startMode === 'slide' && steps.length > 1 && steps[0].overview) ? 1 : 0);
  // Notizen außerhalb der Leinwand: Überblick entsprechend vergrößern.
  if (inkForOverview) { player.includeInOverview(inkForOverview); }
})();
</script>
</body>
</html>`;
