#!/usr/bin/env bash
# Local-only packaging: no Apple account, Developer ID, or notarization upload.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ "$(uname -s)" != Darwin ]]; then echo 'This script requires macOS.' >&2; exit 1; fi
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$ROOT/release/0.1.0-$STAMP"
COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then DIRTY=true; else DIRTY=false; fi
mkdir -p "$OUT" "$ROOT/evidence/current"
# Remove signing-service credentials from this child environment without reading them.
unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_ISSUER APPLE_API_KEY APPLE_API_KEY_PATH APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD
export APPLE_SIGNING_IDENTITY='-'
npm run tauri:build -w @bolgescope/desktop -- --bundles app --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'
APP="$ROOT/apps/desktop/src-tauri/target/release/bundle/macos/BolgeScope.app"
test -x "$APP/Contents/MacOS/bolgescope-desktop"
ditto "$APP" "$OUT/BolgeScope.app"
codesign --verify --deep --strict --verbose=2 "$OUT/BolgeScope.app"
codesign --display --verbose=4 "$OUT/BolgeScope.app" 2> "$OUT/codesign.txt"
# The portable archive remains usable even if this host cannot create a disk image.
ditto -c -k --sequesterRsrc --keepParent "$OUT/BolgeScope.app" "$OUT/BolgeScope-0.1.0-$(uname -m).zip"
STAGE="$(mktemp -d "$OUT/.dmg-stage.XXXXXX")"
cleanup() { if [[ -d "$STAGE" && "$STAGE" == "$OUT"/.dmg-stage.* ]]; then rm -rf "$STAGE"; fi; }
trap cleanup EXIT
ditto "$OUT/BolgeScope.app" "$STAGE/BolgeScope.app"
ln -s /Applications "$STAGE/Applications"
DMG="$OUT/BolgeScope-0.1.0-$(uname -m).dmg"
DMG_STATUS=FAIL
if hdiutil create -volname BolgeScope -srcfolder "$STAGE" -format UDZO -fs HFS+ "$DMG" > "$OUT/dmg-build.log" 2>&1; then
  if hdiutil verify "$DMG" >> "$OUT/dmg-build.log" 2>&1; then DMG_STATUS=PASS; fi
fi
python3 - "$OUT" "$DMG_STATUS" "$COMMIT" "$DIRTY" <<'PY'
import hashlib,json,platform,sys
from pathlib import Path
out=Path(sys.argv[1]); status=sys.argv[2]; commit=sys.argv[3]; dirty=sys.argv[4]=='true'
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
app=out/'BolgeScope.app'
artifacts=[]
for p in [app/'Contents/MacOS/bolgescope-desktop',*out.glob('*.zip'),*out.glob('*.dmg')]:
 artifacts.append({'path':str(p),'bytes':p.stat().st_size,'sha256':digest(p)})
report={'version':'0.1.0','gitCommit':commit,'gitDirty':dirty,'kind':'local-development-preview','platform':platform.platform(),
 'arch':platform.machine(),'app':str(app),'appBytes':sum(p.stat().st_size for p in app.rglob('*') if p.is_file()),
 'appBundle':'PASS','dmgCreateAndVerify':status,'signing':'ad-hoc','notarization':'NOT_RUN','otherMac':'NOT_RUN',
 'artifacts':artifacts}
(out/'artifacts.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
(out.parent/'latest-build.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
PY
if [[ "$DMG_STATUS" != PASS ]]; then echo 'The .app and .zip were built. DMG failed; see dmg-build.log.' >&2; exit 2; fi
