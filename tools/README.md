# QuickGrade dev tools

Optional. Needs Node.

```
cd tools
npm install
npx playwright install chromium
```

Start the app first (`python serve.py --port 5200 --no-browser`), then:

```
npm test                 # runs both self-test pages headlessly, prints failures
npm run shots            # writes a PNG of every screen into this folder
QG_THEME=dark QG_TAG=dark npm run shots
QG_W=430 QG_H=880 QG_TAG=phone npm run shots
```

`shots` seeds a realistic demo class and scans simulated sheets first, so the
screens are captured full rather than empty. Point either script at a different
server with `QG_BASE=http://127.0.0.1:5200`.
