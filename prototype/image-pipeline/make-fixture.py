# PROTOTYPE — throwaway. Builds the ugly photo #14 asks about.
#
# A real phone photo, minus the phone: 4000x3000, EXIF Orientation=6 (rotate
# 90 CW on display), GPS tags pointing at a house, and enough detail that the
# JPEG lands in the 3-5 MB range a phone actually produces. A flat gradient
# compresses to nothing and would make every measurement a lie.
#
#   python3 make-fixture.py

from PIL import Image
from PIL.TiffImagePlugin import IFDRational
import numpy as np
from pathlib import Path

W, H = 4000, 3000
OUT = Path(__file__).parent / "fixtures"
OUT.mkdir(exist_ok=True)


def photo_ish(w, h):
    """Sky gradient + noise + edges. Compresses like a photo, not like a swatch."""
    rng = np.random.default_rng(14)
    y = np.linspace(0, 1, h)[:, None]
    x = np.linspace(0, 1, w)[None, :]

    r = (60 + 150 * y + 40 * np.sin(x * 12)) * np.ones((h, w))
    g = (90 + 120 * y + 30 * np.cos(x * 7 + y * 3)) * np.ones((h, w))
    b = (160 + 80 * y) * np.ones((h, w))

    # Foliage-ish high-frequency detail in the lower half — this is what makes
    # the file big. Without it a 4000px JPEG is under 1 MB and proves nothing.
    detail = rng.normal(0, 26, (h, w))
    mask = (y > 0.45).astype(float)
    r += detail * mask
    g += detail * mask * 1.3
    b += detail * mask * 0.6

    # A few hard edges so the resampler has something to visibly ruin.
    for cx in range(200, w, 700):
        r[:, cx : cx + 40] = 20
        g[:, cx : cx + 40] = 20
        b[:, cx : cx + 40] = 20

    rgb = np.clip(np.dstack([r, g, b]), 0, 255).astype(np.uint8)
    return Image.fromarray(rgb, "RGB")


def deg_to_dms_rational(deg):
    # Pillow's Exif writer wants three rationals for GPSLatitude/Longitude,
    # each an IFDRational — not (num, den) pairs, which it tries to abs() and
    # chokes on.
    deg = abs(deg)
    d = int(deg)
    m = int((deg - d) * 60)
    s = round((deg - d - m / 60) * 3600, 4)
    return (IFDRational(d, 1), IFDRational(m, 1), IFDRational(int(s * 10000), 10000))


img = photo_ish(W, H)

exif = Image.Exif()
exif[0x0112] = 6  # Orientation: rotate 90 CW. The classic sideways-render bug.
exif[0x010F] = "Prototype Phone Co."  # Make
exif[0x0110] = "Ugly 14"  # Model
exif[0x0132] = "2026:07:17 09:14:00"  # DateTime

# GPS IFD — 1600 Pennsylvania Ave. Stands in for the owner's house.
# A nested dict on the GPS pointer tag is the one form Pillow's writer both
# accepts and round-trips; get_ifd() hands back a throwaway copy that never
# serializes, and (num, den) pairs crash the rational writer.
exif[0x8825] = {
    0x0001: "N",
    0x0002: deg_to_dms_rational(38.897957),
    0x0003: "W",
    0x0004: deg_to_dms_rational(77.036560),
    0x0005: 0,
    0x0006: IFDRational(56, 1),
}

path = OUT / "ugly.jpg"
img.save(path, "JPEG", quality=92, exif=exif.tobytes(), subsampling=0)

size = path.stat().st_size
print(f"wrote {path}  {W}x{H}  {size/1e6:.2f} MB")
print(f"  orientation=6, GPS present, quality=92")
