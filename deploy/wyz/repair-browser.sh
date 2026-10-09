#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
[[ $EUID -eq 0 ]] || { echo ROOT_REQUIRED; exit 1; }
release=${1:-/opt/fosuclass/schedule-collector/current}
mode=${2:---diagnose}
[[ $mode == --diagnose || $mode == --repair || $mode == --container ]] || exit 1
release=$(realpath -e "$release")
state=/var/lib/fosuclass/schedule-collector
install -d -m 700 "$state"
export PLAYWRIGHT_BROWSERS_PATH=$state/browsers
client=$release/tools/fosu-sync-client
version=$(node -p "require(process.argv[1]).version" "$client/node_modules/playwright/package.json")
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
echo "PLAYWRIGHT_VERSION=$version"
echo "HOST_GLIBC=$(getconf GNU_LIBC_VERSION)"
if [[ $mode == --repair ]] && command -v dnf >/dev/null; then
  missing_packages=()
  for package in nspr nss binutils python3; do
    rpm -q "$package" >/dev/null 2>&1 || missing_packages+=("$package")
  done
  if ((${#missing_packages[@]})); then dnf install -y --exclude='glibc*' "${missing_packages[@]}"; fi
fi
command -v readelf >/dev/null || { echo BINUTILS_REQUIRED; exit 1; }
binary=$(node -e 'const p=require(process.argv[1]);const fs=require("fs"),path=require("path");let e=p.chromium.executablePath();const dir=path.dirname(path.dirname(e)),base=path.dirname(dir);const shell=fs.existsSync(base)?fs.readdirSync(base).filter(n=>n.startsWith("chromium_headless_shell-")).sort().reverse()[0]:null;if(shell){const s=path.join(base,shell,"chrome-linux","headless_shell"),t=path.join(base,shell,"chrome-headless-shell-linux64","chrome-headless-shell");if(fs.existsSync(t))e=t;else if(fs.existsSync(s))e=s;}process.stdout.write(e);' "$client/node_modules/playwright")
native_compatible=false
if [[ -f $binary ]]; then
  readelf -h "$binary" | awk '/Class:|Machine:/ {print}'
  required=$(readelf --version-info "$binary" | grep -oE 'GLIBC_[0-9]+\.[0-9]+' | sort -Vu | tail -1 || true)
  echo "BROWSER_REQUIRED_GLIBC=${required:-UNKNOWN}"
  dependencies=$(ldd "$binary" 2>&1 || true)
  # Output contains library names/paths only; no browser arguments or sessions.
  printf '%s\n' "$dependencies" | awk '/not found|GLIBC_[0-9]/ {print}'
  if ! grep -qE 'GLIBC_[0-9.]+.*not found|GLIBC_[0-9.]+.*找不到' <<< "$dependencies"; then
    native_compatible=true
    if [[ $mode == --repair ]] && command -v dnf >/dev/null; then
      mapfile -t missing_libs < <(printf '%s\n' "$dependencies" | awk '/=> not found/ {print $1}' | sort -u)
      # Ask enabled distribution repositories for the actual provider. Never
      # guess CAM-like names or replace/upgrade glibc or all system packages.
      for library in "${missing_libs[@]}"; do
        [[ $library =~ ^lib[A-Za-z0-9_.+-]+\.so(\.[0-9]+)*$ ]] || exit 1
        [[ $library != libc.so* && $library != libpthread.so* && $library != libdl.so* ]] || { echo SYSTEM_GLIBC_REPLACEMENT_REJECTED; exit 1; }
        dnf provides "*/$library"
        dnf install -y --exclude='glibc*' "*/$library"
      done
    fi
  fi
else
  echo BROWSER_EXECUTABLE_MISSING
fi
if [[ $mode != --container && $native_compatible == true ]] && node "$release/tools/wyz-schedule-collector/browser-smoke.js"; then
  if [[ $mode == --repair ]]; then
    printf '{"mode":"native"}\n' > "$state/browser-runtime.json.next"
    chmod 600 "$state/browser-runtime.json.next"
    mv -T "$state/browser-runtime.json.next" "$state/browser-runtime.json"
  fi
  echo NATIVE_BROWSER=PASS
  exit 0
fi
[[ $mode != --diagnose ]] || { echo NATIVE_BROWSER=FAILED; echo ISOLATED_RUNTIME_REQUIRED; exit 1; }
engine=
for candidate in podman docker; do
  if command -v "$candidate" >/dev/null && "$candidate" info >/dev/null 2>&1; then engine=$candidate; break; fi
done
if [[ -z $engine ]]; then echo 'CONTAINER_RUNTIME_REQUIRED: install podman from the enabled Anolis repository'; exit 1; fi
"$engine" build --build-arg "PLAYWRIGHT_VERSION=$version" -f "$release/deploy/wyz/Collector.Dockerfile" -t fosuclass-collector-browser:verified "$release"
image=$("$engine" image inspect --format '{{.Id}}' fosuclass-collector-browser:verified)
[[ $image =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
# No school/network access during acceptance. Entire launch/newContext/newPage/
# local render/close lifecycle runs in the exact image the worker will use.
"$engine" run --rm --init --network=none --cap-drop=ALL --security-opt=no-new-privileges --read-only --shm-size=256m --tmpfs /tmp:rw,noexec,nosuid,size=256m "$image"
node -e 'const f=require("fs"),p=process.argv[1];f.writeFileSync(p+".next",JSON.stringify({mode:"container",engine:process.argv[2],image:process.argv[3]}),{mode:0o600});f.chmodSync(p+".next",0o600);f.renameSync(p+".next",p);' "$state/browser-runtime.json" "$engine" "$image"
echo "ISOLATED_BROWSER=PASS ENGINE=$engine"
