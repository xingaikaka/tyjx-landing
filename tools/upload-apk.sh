#!/usr/bin/env bash
#
# upload-apk.sh
#   一条命令把 .apk 发布到落地页(R2 固定 key + EdgeOne 主动刷新 CDN)。
#
#   1) PUT 一次到 R2 桶  s3://${R2_BUCKET}/downloads/<slug>.bin   (同 key 覆盖)
#   2) 调腾讯云 EdgeOne CreatePurgeTask 刷新 CDN URL
#         https://${CDN_BASE}/downloads/<slug>.bin
#
# 用法:
#   ./upload-apk.sh [--slug tianya] [--skip-purge] [--config <file>] <apk-path>
#
# 配置:~/.apk-upload.env(参考 .apk-upload.env.example)
#
# 依赖:bash 4+ / curl / openssl(macOS、Linux 默认都有)

set -euo pipefail

# ─────────────── 颜色 / 工具 ───────────────
if [ -t 1 ]; then
  C_RESET='\033[0m'; C_RED='\033[31m'; C_GREEN='\033[32m'
  C_YELLOW='\033[33m'; C_CYAN='\033[36m'; C_BOLD='\033[1m'; C_DIM='\033[2m'
else
  C_RESET=; C_RED=; C_GREEN=; C_YELLOW=; C_CYAN=; C_BOLD=; C_DIM=
fi

die() { printf '%b\n' "${C_RED}错误:${C_RESET} $*" >&2; exit 1; }

# 文件大小(macOS BSD stat / Linux GNU stat)
fsize() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }

# sha256 hex
sha256_hex_str() { printf '%s' "$1" | openssl dgst -sha256 -hex | awk '{print $NF}'; }
sha256_hex_file() { openssl dgst -sha256 -hex < "$1" | awk '{print $NF}'; }

# HMAC-SHA256:string-key + str-msg → hex
hmac_strkey()  { printf '%s' "$2" | openssl dgst -sha256 -hmac "$1"          -hex | awk '{print $NF}'; }
# HMAC-SHA256:hex-key   + str-msg → hex
hmac_hexkey()  { printf '%s' "$2" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$1" -hex | awk '{print $NF}'; }

# 友好打印字节数
fmt_bytes() {
  local n=$1
  if   [ "$n" -lt 1024 ]; then printf '%d B' "$n"
  elif [ "$n" -lt 1048576 ]; then awk -v n="$n" 'BEGIN{printf "%.1f KB", n/1024}'
  elif [ "$n" -lt 1073741824 ]; then awk -v n="$n" 'BEGIN{printf "%.1f MB", n/1048576}'
  else awk -v n="$n" 'BEGIN{printf "%.2f GB", n/1073741824}'
  fi
}

usage() {
  cat <<EOF
用法:
  $(basename "$0") [选项] <apk-path>

选项:
  --slug <name>      固定地址 slug,默认 'tianya';上传 R2 key = downloads/<slug>.bin
  --skip-purge       只 PUT R2,不调 EdgeOne
  --config <file>    指定 env 配置文件(默认 \$APK_UPLOAD_CONFIG 或 ~/.apk-upload.env)
  -h, --help         查看帮助

env 必填:
  R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET
  TENCENT_SECRET_ID  TENCENT_SECRET_KEY  TENCENT_EDGEONE_ZONE_ID
  CDN_BASE       (例:https://tyjx.calculus.xin;兼容老变量 TYJX_CDN_BASE)
EOF
}

# ─────────────── 参数解析 ───────────────
SLUG=""
APK_PATH=""
SKIP_PURGE=0
CONFIG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --slug)        SLUG="$2"; shift 2 ;;
    --skip-purge)  SKIP_PURGE=1; shift ;;
    --config)      CONFIG="$2"; shift 2 ;;
    -h|--help)     usage; exit 0 ;;
    --*)           die "未知选项: $1" ;;
    *)             [ -z "$APK_PATH" ] && APK_PATH="$1" || die "多余参数: $1"; shift ;;
  esac
done

[ -z "$APK_PATH" ] && { usage; echo; die "缺少 <apk-path>"; }
[ -f "$APK_PATH" ] || die "文件不存在: $APK_PATH"
case "$APK_PATH" in *.apk) ;; *) die "必须是 .apk 文件: $APK_PATH" ;; esac

# ─────────────── 加载 env ───────────────
[ -z "$CONFIG" ] && CONFIG="${APK_UPLOAD_CONFIG:-$HOME/.apk-upload.env}"

if [ -f "$CONFIG" ]; then
  printf '%bconfig%b  %s\n' "$C_DIM" "$C_RESET" "$CONFIG"
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG"
  set +a
else
  printf '%bconfig%b  (未找到 %s,完全靠 env 变量)\n' "$C_DIM" "$C_RESET" "$CONFIG"
fi

# 取 slug:命令行 > env APK_DEFAULT_SLUG > 'tianya'
SLUG="${SLUG:-${APK_DEFAULT_SLUG:-tianya}}"
# 规范化 slug:小写、字母数字 _ -,长度 1~32
SLUG=$(printf '%s' "$SLUG" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/\.apk$//' \
  | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+|-+$//g' \
  | cut -c1-32)
[ -z "$SLUG" ] && SLUG="tianya"

# CDN_BASE 兼容老变量 TYJX_CDN_BASE
CDN_BASE="${CDN_BASE:-${TYJX_CDN_BASE:-}}"

# 必填校验
for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET \
         TENCENT_SECRET_ID TENCENT_SECRET_KEY TENCENT_EDGEONE_ZONE_ID \
         CDN_BASE; do
  if [ -z "${!v:-}" ]; then die "缺少 env: $v"; fi
done

R2_HOST="${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
KEY="downloads/${SLUG}.bin"
URI="/${R2_BUCKET}/${KEY}"
SIZE=$(fsize "$APK_PATH")
PAYLOAD_SHA=$(sha256_hex_file "$APK_PATH")

CDN_URL="${CDN_BASE%/}/${KEY}"

# ─────────────── 概览 ───────────────
printf '\n%b📦  %s%b\n' "$C_BOLD" "$(basename "$APK_PATH")" "$C_RESET"
printf '    path:   %s\n' "$APK_PATH"
printf '    size:   %s  (%s bytes)\n' "$(fmt_bytes "$SIZE")" "$SIZE"
printf '    sha256: %s\n' "$PAYLOAD_SHA"
printf '    slug:   %b%s%b\n' "$C_CYAN" "$SLUG" "$C_RESET"
printf '\n%b计划%b:\n' "$C_BOLD" "$C_RESET"
printf '  R2:   s3://%s/%s\n' "$R2_BUCKET" "$KEY"
printf '  CDN:  %s\n\n' "$CDN_URL"

# ─────────────── R2 PUT (AWS Signature V4) ───────────────
NOW=$(date -u +%Y%m%dT%H%M%SZ)
DATE=$(date -u +%Y%m%d)
REGION="auto"
SERVICE="s3"
ALGO="AWS4-HMAC-SHA256"

CT="application/vnd.android.package-archive"
CD="attachment; filename=\"${SLUG}.apk\""
CC="public, max-age=0, s-maxage=300, must-revalidate"

# Canonical request:每个 header 末尾各带一个 \n,headers 块和 signedHeaders 之间还要一个 \n
# (拼出来就是 ...\nx-amz-date:NOW\n\nsigned;headers...)
CANON_HEADERS=$(printf 'cache-control:%s\ncontent-disposition:%s\ncontent-type:%s\nhost:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n' \
  "$CC" "$CD" "$CT" "$R2_HOST" "$PAYLOAD_SHA" "$NOW")
SIGNED="cache-control;content-disposition;content-type;host;x-amz-content-sha256;x-amz-date"

CANON_REQ=$(printf '%s\n%s\n%s\n%s\n%s\n%s' \
  "PUT" "$URI" "" "$CANON_HEADERS" "$SIGNED" "$PAYLOAD_SHA")
CR_HASH=$(sha256_hex_str "$CANON_REQ")

SCOPE="${DATE}/${REGION}/${SERVICE}/aws4_request"
STS=$(printf '%s\n%s\n%s\n%s' "$ALGO" "$NOW" "$SCOPE" "$CR_HASH")

K_DATE=$(hmac_strkey  "AWS4${R2_SECRET_ACCESS_KEY}" "$DATE")
K_REG=$(hmac_hexkey   "$K_DATE" "$REGION")
K_SVC=$(hmac_hexkey   "$K_REG"  "$SERVICE")
K_SIGN=$(hmac_hexkey  "$K_SVC"  "aws4_request")
SIG=$(hmac_hexkey     "$K_SIGN" "$STS")

AUTH="${ALGO} Credential=${R2_ACCESS_KEY_ID}/${SCOPE}, SignedHeaders=${SIGNED}, Signature=${SIG}"

URL_R2="https://${R2_HOST}${URI}"
printf '%b↑ R2 PUT%b  uploading %s … ' "$C_CYAN" "$C_RESET" "$(fmt_bytes "$SIZE")"
T0=$(date +%s)
HTTP_CODE=$(curl -sS -o /tmp/upload-apk.r2.resp.$$ -w '%{http_code}' \
  -X PUT \
  -H "Host: ${R2_HOST}" \
  -H "Cache-Control: ${CC}" \
  -H "Content-Disposition: ${CD}" \
  -H "Content-Type: ${CT}" \
  -H "x-amz-content-sha256: ${PAYLOAD_SHA}" \
  -H "x-amz-date: ${NOW}" \
  -H "Authorization: ${AUTH}" \
  -T "$APK_PATH" \
  "$URL_R2") || true
T1=$(date +%s)
DT=$((T1 - T0))
[ "$DT" -lt 1 ] && DT=1

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  printf '%b✓%b (%ds)\n' "$C_GREEN" "$C_RESET" "$DT"
  rm -f "/tmp/upload-apk.r2.resp.$$"
else
  printf '%b✗ HTTP %s%b\n' "$C_RED" "$HTTP_CODE" "$C_RESET"
  echo "--- R2 response ---"
  cat "/tmp/upload-apk.r2.resp.$$" 2>/dev/null || true
  echo
  echo "------"
  rm -f "/tmp/upload-apk.r2.resp.$$"
  exit 1
fi

# ─────────────── 腾讯 EdgeOne CreatePurgeTask (TC3-HMAC-SHA256) ───────────────
if [ "$SKIP_PURGE" = "1" ]; then
  printf '%b⚠ --skip-purge,跳过 CDN 刷新%b\n\n' "$C_YELLOW" "$C_RESET"
else
  TEO_HOST="teo.tencentcloudapi.com"
  TEO_ACTION="CreatePurgeTask"
  TEO_VERSION="2022-09-01"
  TS=$(date +%s)
  D=$(date -u -r "$TS" +%Y-%m-%d 2>/dev/null || date -u -d "@$TS" +%Y-%m-%d)

  PAYLOAD=$(printf '{"ZoneId":"%s","Type":"purge_url","Targets":["%s"]}' \
    "$TENCENT_EDGEONE_ZONE_ID" "$CDN_URL")
  P_HASH=$(sha256_hex_str "$PAYLOAD")

  TEO_CT="application/json; charset=utf-8"
  TEO_CHEAD=$(printf 'content-type:%s\nhost:%s\nx-tc-action:%s\n' \
    "$TEO_CT" "$TEO_HOST" "$(printf '%s' "$TEO_ACTION" | tr '[:upper:]' '[:lower:]')")
  TEO_SH="content-type;host;x-tc-action"
  TEO_CR=$(printf '%s\n%s\n%s\n%s\n%s\n%s' "POST" "/" "" "$TEO_CHEAD" "$TEO_SH" "$P_HASH")
  TEO_CR_HASH=$(sha256_hex_str "$TEO_CR")

  TEO_SCOPE="${D}/teo/tc3_request"
  TEO_STS=$(printf 'TC3-HMAC-SHA256\n%s\n%s\n%s' "$TS" "$TEO_SCOPE" "$TEO_CR_HASH")

  TEO_KD=$(hmac_strkey  "TC3${TENCENT_SECRET_KEY}" "$D")
  TEO_KS=$(hmac_hexkey  "$TEO_KD" "teo")
  TEO_KSIG=$(hmac_hexkey "$TEO_KS" "tc3_request")
  TEO_SIG=$(hmac_hexkey "$TEO_KSIG" "$TEO_STS")

  TEO_AUTH="TC3-HMAC-SHA256 Credential=${TENCENT_SECRET_ID}/${TEO_SCOPE}, SignedHeaders=${TEO_SH}, Signature=${TEO_SIG}"

  printf '%b🔄 EdgeOne purge%b\n' "$C_CYAN" "$C_RESET"
  printf '    %s\n' "$CDN_URL"
  RESP=$(curl -sS -X POST "https://${TEO_HOST}/" \
    -H "Content-Type: ${TEO_CT}" \
    -H "Host: ${TEO_HOST}" \
    -H "Authorization: ${TEO_AUTH}" \
    -H "X-TC-Action: ${TEO_ACTION}" \
    -H "X-TC-Timestamp: ${TS}" \
    -H "X-TC-Version: ${TEO_VERSION}" \
    --data "$PAYLOAD") || RESP=""

  if echo "$RESP" | grep -q '"Error"'; then
    CODE=$(printf '%s' "$RESP"    | sed -n 's/.*"Code":"\([^"]*\)".*/\1/p')
    MSG=$(printf '%s' "$RESP"     | sed -n 's/.*"Message":"\([^"]*\)".*/\1/p')
    printf '  %b✗ %s: %s%b\n\n' "$C_RED" "${CODE:-Unknown}" "${MSG:-$RESP}" "$C_RESET"
    exit 1
  fi
  JOB=$(printf '%s' "$RESP" | sed -n 's/.*"JobId":"\([^"]*\)".*/\1/p')
  printf '  %b✓ taskId=%s%b  (1~5min 全网生效)\n\n' "$C_GREEN" "${JOB:--}" "$C_RESET"
fi

# ─────────────── 完成 ───────────────
printf '%b✅ 完成%b\n' "$C_GREEN" "$C_RESET"
printf '  CDN: %s\n' "$CDN_URL"
