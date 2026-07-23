/**
 * A baked inkblot PNG, re-inked into the current sky palette. The blot is
 * drawn to a canvas and duotoned per pixel (see recolorInkblot) so its layered
 * depth survives while its hue tracks the hour. Because it's a raster — unlike
 * the sigil, which re-inks in pure CSS via a mask — the recolor is redone in JS
 * whenever the sky hour, and therefore the palette, changes.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useTheme } from '../../hooks/useTheme.jsx';
import { paletteForHour } from '../../lib/skyTheme.js';
import { inkblotRamp, hexToRgb, recolorInkblot } from '../../lib/anisotaLab.js';

export default function InkblotFigure({ image, palette, label }) {
  const canvasRef = useRef(null);
  const { skyDisplayHour } = useTheme();

  // The two ramp stops for this blot's palette slot, resolved to the live
  // hour's hex. Recomputed only when the hour (hence palette) actually moves.
  const [denseHex, faintHex] = useMemo(() => {
    const vars = paletteForHour(skyDisplayHour).vars;
    return inkblotRamp(palette).map((token) => vars[token]);
  }, [skyDisplayHour, palette]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const dense = hexToRgb(denseHex);
    const faint = hexToRgb(faintHex);
    if (!dense || !faint) return undefined;

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || 512;
      const h = img.naturalHeight || 512;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      let id;
      try {
        id = ctx.getImageData(0, 0, w, h);
      } catch {
        return; // tainted canvas — shouldn't happen for a same-origin data URL
      }
      recolorInkblot(id.data, dense, faint);
      ctx.putImageData(id, 0, 0);
    };
    img.src = image;
    return () => {
      cancelled = true;
    };
  }, [image, denseHex, faintHex]);

  return (
    <canvas
      ref={canvasRef}
      className="lab-inkblot-canvas"
      width={512}
      height={512}
      role="img"
      aria-label={label}
    />
  );
}
