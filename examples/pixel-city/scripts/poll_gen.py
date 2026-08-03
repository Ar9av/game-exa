"""Poll meshroom generations and save finished PNGs.

Usage: MESHROOM_KEY=... python3 poll_gen.py <scratch_dir> name=id [name=id ...]
Saves <scratch_dir>/<name>.png for each completed generation.
"""
import base64
import json
import os
import sys
import time
import urllib.request

scratch = sys.argv[1]
jobs = dict(a.split('=', 1) for a in sys.argv[2:])
key = os.environ['MESHROOM_KEY']

pending = dict(jobs)
for attempt in range(40):
    for name, gid in list(pending.items()):
        req = urllib.request.Request(
            f'https://meshroom.top/api/v1/generate/{gid}',
            headers={'Authorization': f'Bearer {key}'})
        raw = urllib.request.urlopen(req).read().decode()
        d = json.JSONDecoder(strict=False).decode(raw)
        st = d.get('status')
        if st == 'complete':
            url = d.get('imageUrl') or ''
            if url.startswith('data:'):
                data = base64.b64decode(url.split(',', 1)[1])
            else:
                data = urllib.request.urlopen(url).read()
            with open(f'{scratch}/{name}.png', 'wb') as f:
                f.write(data)
            print(f'{name}: complete -> {name}.png ({len(data)} bytes)')
            del pending[name]
        elif st == 'failed':
            print(f'{name}: FAILED')
            del pending[name]
        else:
            print(f'{name}: {st}')
    if not pending:
        break
    time.sleep(10)
print('done; unfinished:', list(pending) or 'none')
