// PROTOTYPE — the native downscale path, written as it would ship so its
// bundle cost is measurable (see size.js). Zero dependencies on purpose: the
// #14 budget question is "what does the NATIVE path cost", and the answer is
// only honest if nothing but browser APIs is used.
//
// Two decisions are baked in here and are the thing to judge:
//
//   1. createImageBitmap(blob, { imageOrientation: 'from-image' }) is what
//      applies the EXIF rotation. Draw that bitmap and the canvas holds
//      upright pixels — orientation solved without reading EXIF ourselves.
//
//   2. Drawing to a canvas and re-encoding is what strips EXIF, GPS included.
//      That is a side effect, not a feature we wrote — which is exactly why
//      #14 calls it "silent". The prototype makes it loud (size.js reports it).

const MAX_EDGE = 1600; // long edge cap. A blog column is ~700px CSS; 1600 is 2x retina with room.
const QUALITY = 0.82; // JPEG quality for the re-encode.

/**
 * @param {Blob} file  the dropped photo
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function downscale(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
  return { blob, width: w, height: h };
}
