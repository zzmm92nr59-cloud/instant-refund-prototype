# Makes every logo in logos/ a PNG at most 192px on its longer side (SVGs stay as they are): the app shows logos at 64px
# or less, so this keeps them sharp on any screen while making them small to download. Run after scripts/fetch-logos.mjs.
import json, os
from PIL import Image
MAX = 192
report_path = os.path.join("logos", "_report.json")
report = json.load(open(report_path)) if os.path.exists(report_path) else {"hits": {}}
saved = 0
for f in sorted(os.listdir("logos")):
    if f.startswith("_") or f.endswith(".svg"):
        continue
    path = os.path.join("logos", f)
    domain, ext = f.rsplit(".", 1)
    try:
        im = Image.open(path)
        if ext == "ico" and hasattr(im, "ico"):
            im.size = max(im.ico.sizes(), key=lambda s: s[0] * s[1])
        im.load()
        im = im.convert("RGBA")
    except Exception as e:
        print("skipped", f, e)
        continue
    if ext == "png" and max(im.size) <= MAX and os.path.getsize(path) <= 20000:
        continue
    if max(im.size) > MAX:
        im.thumbnail((MAX, MAX), Image.LANCZOS)
    out = os.path.join("logos", domain + ".png")
    before = os.path.getsize(path)
    im.save(out, "PNG", optimize=True)
    # A logo that is really a photo stays big as a full-colour PNG: 256 colours look the same at this size.
    if os.path.getsize(out) > 20000:
        im.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(out + ".tmp", "PNG", optimize=True)
        if os.path.getsize(out + ".tmp") < os.path.getsize(out) * 0.7:
            os.replace(out + ".tmp", out)
        else:
            os.remove(out + ".tmp")
    if out != path:
        os.remove(path)
    saved += before - os.path.getsize(out)
    h = report["hits"].get(domain)
    if h is not None:
        h["file"] = domain + ".png"; h["px"] = max(im.size); h["bytes"] = os.path.getsize(out)
json.dump(report, open(report_path, "w"), indent=1)
print("saved %d KB" % (saved // 1024))
