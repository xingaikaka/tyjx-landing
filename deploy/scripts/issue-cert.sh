#!/usr/bin/env bash
# 用 acme.sh + Cloudflare DNS-01 给 finalLanding 域签 wildcard 证书
#
# 用法:
#   export CF_Token="cf-api-token"
#   export CF_Account_ID="cf-account-id"
#   bash issue-cert.sh tyjxhotpzixm.cc
#
# 前置:
#   - acme.sh 已安装 (curl https://get.acme.sh | sh)
#   - /etc/nginx/ssl/ 目录存在,nginx 进程可读
#   - 该域的 NS 已经托管到 Cloudflare(签 wildcard 必须用 DNS challenge)

set -e

domain="${1:-}"
if [[ -z "$domain" ]]; then
  echo "Usage: $0 <root-domain>"
  echo "Example: $0 tyjxhotpzixm.cc"
  exit 1
fi

if [[ -z "${CF_Token:-}" || -z "${CF_Account_ID:-}" ]]; then
  echo "ERR: CF_Token / CF_Account_ID env not set"
  exit 1
fi

ACME_BIN="${HOME}/.acme.sh/acme.sh"
if [[ ! -x "$ACME_BIN" ]]; then
  echo "ERR: acme.sh not found at $ACME_BIN"
  exit 1
fi

SSL_DIR="/etc/nginx/ssl"
sudo mkdir -p "$SSL_DIR"

echo ">>> Issuing wildcard cert for $domain"
"$ACME_BIN" --issue --dns dns_cf \
  -d "$domain" \
  -d "*.$domain" \
  --keylength 2048

echo ">>> Installing cert into $SSL_DIR"
"$ACME_BIN" --install-cert -d "$domain" \
  --key-file       "$SSL_DIR/${domain}.key" \
  --fullchain-file "$SSL_DIR/${domain}.crt" \
  --reloadcmd      "sudo systemctl reload nginx"

echo "OK. Cert installed: $SSL_DIR/${domain}.crt"
