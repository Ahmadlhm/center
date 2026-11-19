#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

root=/opt/quran-center
deploy="$root/deploy"
production="$root/production"
repository="$deploy/repository.git"
state="$deploy/active-release"
exec 9>"$deploy/update.lock"
flock -n 9 || exit 0

read -r previous_commit previous_release < "$state"
export GIT_SSH_COMMAND="ssh -i $deploy/github_ed25519 -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$deploy/github_known_hosts"
git -C "$repository" fetch --quiet --no-tags origin refs/heads/main
commit="$(git -C "$repository" rev-parse FETCH_HEAD)"
if [[ "$commit" == "$previous_commit" ]]; then
    printf 'Production is current at %s\n' "$commit"
    exit 0
fi
git -C "$repository" merge-base --is-ancestor "$previous_commit" "$commit"

release="$root/releases/$commit"
if [[ ! -f "$release/.prepared" ]]; then
    install -d -m 0750 "$release"
    git -C "$repository" archive "$commit" | tar -xf - -C "$release"
    {
        printf 'services:\n'
        for service in identity people education work documents gateway; do
            printf '  %s:\n    image: quran-center-runtime:%s\n' "$service" "$commit"
        done
        printf '  import:\n    image: quran-center-ocr:%s\n' "$commit"
        printf '  web:\n    image: quran-center-web:%s\n' "$commit"
    } > "$release/compose.images.yaml"
    touch "$release/.prepared"
fi

compose_release() {
    local directory="$1"
    shift
    local files=(-f "$directory/compose.yaml" -f "$directory/compose.production.yaml" -f "$production/compose.address.yaml")
    if [[ -f "$directory/compose.images.yaml" ]]; then
        files+=(-f "$directory/compose.images.yaml")
    fi
    docker compose --env-file "$production/.env" "${files[@]}" "$@"
}

ready() {
    local domain
    domain="$(sed -n 's/^CENTER_DOMAIN=//p' "$production/.env")"
    for attempt in {1..25}; do
        if curl --max-time 4 -fsS --resolve "$domain:443:127.0.0.1" "https://$domain/api/auth/info" 2>/dev/null | grep -Fq '"demo":false' &&
            curl --max-time 4 -fsS --resolve "$domain:443:127.0.0.1" "https://$domain/" >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done
    return 1
}

export COMPOSE_PARALLEL_LIMIT=2
compose_release "$release" config --quiet
compose_release "$release" build identity import web
if compose_release "$release" up -d --no-build --wait --wait-timeout 120 && ready; then
    printf '%s %s\n' "$commit" "$release" > "$state.new"
    mv "$state.new" "$state"
    printf 'Deployed %s\n' "$commit"
else
    printf 'Readiness failed for %s. Restoring %s\n' "$commit" "$previous_commit" >&2
    compose_release "$previous_release" up -d --no-build --wait --wait-timeout 120
    ready
    exit 1
fi
