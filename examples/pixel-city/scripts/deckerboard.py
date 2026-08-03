"""Strip a baked-in transparency checkerboard from a sprite sheet and slice frames.

Usage: python3 deckerboard.py <sheet.png> <n_frames> <outdir> <prefix>
Flood-fills from the image edges across light desaturated pixels, so light
pixels inside the character survive.
"""
import sys
from collections import deque
from PIL import Image

sheet, n, outdir, prefix = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]

img = Image.open(sheet).convert('RGBA')
W, H = img.size
px = img.load()


def is_bg(p):
    r, g, b, a = p
    return r > 200 and g > 200 and b > 200 and abs(r - g) < 14 and abs(g - b) < 14


seen = [[False] * W for _ in range(H)]
q = deque()
for x in range(W):
    for y in (0, H - 1):
        if is_bg(px[x, y]) and not seen[y][x]:
            seen[y][x] = True
            q.append((x, y))
for y in range(H):
    for x in (0, W - 1):
        if is_bg(px[x, y]) and not seen[y][x]:
            seen[y][x] = True
            q.append((x, y))
while q:
    x, y = q.popleft()
    px[x, y] = (0, 0, 0, 0)
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if 0 <= nx < W and 0 <= ny < H and not seen[ny][nx] and is_bg(px[nx, ny]):
            seen[ny][nx] = True
            q.append((nx, ny))

fw = W // n
for i in range(n):
    fr = img.crop((i * fw, 0, (i + 1) * fw, H))
    bbox = fr.getbbox()
    if bbox:
        fr = fr.crop(bbox)
    fr.save(f'{outdir}/{prefix}_{i}.png')
    print(f'frame {i}: {fr.size}')
