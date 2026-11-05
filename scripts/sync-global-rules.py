import argparse
import ipaddress
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
RULESET = ROOT / "ruleset"
GROUPS = ("ai", "social", "common", "global")
CUSTOM_GLOBAL = RULESET / "custom_global.list"
BLACKMATRIX = "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/refs/heads/master/rule/Clash"
LIANDU = "https://raw.githubusercontent.com/liandu2024/clash/refs/heads/main/list"
VPSDANCE_LOON = "https://raw.githubusercontent.com/VPSDance/ai-proxy-rules/refs/heads/main/rules/loon"
SOURCES = {
    "ai": (
        *(
            f"{BLACKMATRIX}/{name}/{name}.list"
            for name in ("OpenAI", "Anthropic", "Claude", "Gemini", "Copilot")
        ),
        *(f"{VPSDANCE_LOON}/{name}.list" for name in (
            "x-ai", "cursor", "augment-code", "midjourney", "kiro", "windsurf", "devin",
            "perplexity", "opencode",
        )),
    ),
    "social": tuple(
        f"{BLACKMATRIX}/{name}/{name}.list"
        for name in ("TikTok", "Twitter", "Facebook")
    ),
    "common": (
        f"{LIANDU}/YouTube.list",
        *(
            f"{BLACKMATRIX}/{name}/{name}.list"
            for name in (
                "YouTube", "Disney", "Netflix", "HBO", "Spotify",
                "Steam", "Epic", "EA", "Blizzard", "UBI", "Sony", "Nintendo",
                "GitHub", "Telegram",
            )
        ),
    ),
    "global": (
        f"{LIANDU}/Check.list",
        f"{LIANDU}/Proxy.list",
        f"{BLACKMATRIX}/Global/Global.list",
    ),
}

# Keep critical service endpoints covered even when an upstream list omits or later removes them.
AI_SEEDS = (
    "DOMAIN,chat.openai.com",
    "DOMAIN,api.openai.com",
    "DOMAIN-SUFFIX,claude.com",
    "DOMAIN-SUFFIX,clau.de",
    "DOMAIN-SUFFIX,claudemcpclient.com",
    "DOMAIN-SUFFIX,claudeusercontent.com",
    "DOMAIN,aistudio.google.com",
    "DOMAIN,gemini.google.com",
    "DOMAIN,bard.google.com",
    "DOMAIN,makersuite.google.com",
    "DOMAIN,generativelanguage.googleapis.com",
    "DOMAIN-SUFFIX,grok.com",
    "DOMAIN-SUFFIX,grok.x.com",
    "DOMAIN-SUFFIX,grokipedia.com",
    "DOMAIN-SUFFIX,x.ai",
    "DOMAIN-SUFFIX,cursor.com",
    "DOMAIN,api.cursor.com",
    "DOMAIN,repo49.cursor.com",
    "DOMAIN-SUFFIX,cursor-cdn.com",
    "DOMAIN-SUFFIX,cursor.sh",
    "DOMAIN-SUFFIX,cursorapi.com",
    "DOMAIN-SUFFIX,cursorvm.com",
    "DOMAIN-SUFFIX,augmentcode.com",
    "DOMAIN-SUFFIX,midjourney.com",
    "DOMAIN-SUFFIX,mj-gallery.com",
    "DOMAIN-SUFFIX,discord.com",
    "DOMAIN-SUFFIX,discord.gg",
    "DOMAIN-SUFFIX,discordapp.com",
    "DOMAIN-SUFFIX,discordapp.net",
    "DOMAIN-SUFFIX,kiro.dev",
    "DOMAIN-SUFFIX,q.eu-central-1.amazonaws.com",
    "DOMAIN,q.us-east-1.amazonaws.com",
    "DOMAIN,codewhisperer.us-east-1.amazonaws.com",
    "DOMAIN-SUFFIX,windsurf.com",
    "DOMAIN-SUFFIX,windsurf.build",
    "DOMAIN-SUFFIX,codeium.com",
    "DOMAIN-SUFFIX,codeiumdata.com",
    "DOMAIN-SUFFIX,devin.ai",
    "DOMAIN-SUFFIX,cognition.ai",
    "DOMAIN-SUFFIX,cognition.com",
    "DOMAIN-SUFFIX,meta.ai",
    "DOMAIN-SUFFIX,meta.com",
    "DOMAIN-SUFFIX,metademolab.com",
    "DOMAIN-SUFFIX,muse.ai",
    "DOMAIN-SUFFIX,metaaivm.com",
    "DOMAIN-SUFFIX,metaaiusercontent.com",
    "DOMAIN-SUFFIX,perplexity.ai",
    "DOMAIN-SUFFIX,genspark.ai",
    "DOMAIN-SUFFIX,poe.com",
    "DOMAIN-SUFFIX,groq.com",
    "DOMAIN-SUFFIX,mistral.ai",
    "DOMAIN-SUFFIX,arena.ai",
    "DOMAIN-SUFFIX,lmarena.ai",
    "DOMAIN-SUFFIX,nof1.ai",
    "DOMAIN-SUFFIX,lovable.dev",
    "DOMAIN-SUFFIX,deepwiki.com",
    "DOMAIN-SUFFIX,framelink.ai",
    "DOMAIN-SUFFIX,opencode.ai",
    "DOMAIN-SUFFIX,difyai.com",
    "DOMAIN-SUFFIX,modelcontextprotocol.io",
    "DOMAIN-SUFFIX,agnes-ai.com",
    "DOMAIN-SUFFIX,pavo-ai.work",
    "DOMAIN-SUFFIX,leonardo.ai",
    "DOMAIN-SUFFIX,typesafe.ai",
    "DOMAIN-SUFFIX,jevai.org",
    "DOMAIN-SUFFIX,skillsvc.cc",
    "DOMAIN-SUFFIX,qoder.com",
    "DOMAIN-SUFFIX,qoder.sh",
)
DOMAIN_TYPES = {"DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD"}
NETWORK_TYPES = {"IP-CIDR", "IP-CIDR6", "IP-ASN"}
SUPPORTED_TYPES = DOMAIN_TYPES | NETWORK_TYPES | {"DOMAIN-REGEX", "PROCESS-NAME", "PROCESS-PATH"}
MAX_SOURCE_BYTES = 10 * 1024 * 1024
CUSTOM_BEGIN = b"# BEGIN managed custom_global.list"
CUSTOM_END = b"# END managed custom_global.list"


def migrate_rule_files() -> int:
    if not RULESET.is_dir():
        raise ValueError(f"Ruleset directory does not exist: {RULESET}")
    legacy = RULESET / "lists"
    if not legacy.exists():
        return 0
    if not legacy.is_dir():
        raise ValueError(f"Legacy rule path is not a directory: {legacy}")
    names = [f"{group}.list" for group in GROUPS] + ["custom_global.list"]
    pending = []
    # Check every destination before moving any file; never overwrite another rule list.
    for name in names:
        source = legacy / name
        if source.exists():
            destination = RULESET / name
            if not source.is_file() or destination.exists():
                raise ValueError(f"Cannot safely migrate {source} to {destination}")
            pending.append((source, destination))
    for source, destination in pending:
        source.rename(destination)
        print(f"Moved {source} -> {destination}")
    if not any(legacy.iterdir()):
        legacy.rmdir()
    return len(pending)


def normalize_rule(line: str, source: str) -> str:
    parts = [part.strip() for part in line.split(",")]
    kind = parts[0]
    if kind not in SUPPORTED_TYPES:
        raise ValueError(f"{source}: unsupported rule type: {kind!r}")
    if len(parts) < 2 or not parts[1]:
        raise ValueError(f"{source}: missing rule value")
    if kind in NETWORK_TYPES:
        if len(parts) > 3 or (len(parts) == 3 and parts[2] != "no-resolve"):
            raise ValueError(f"{source}: invalid network options: {line!r}")
        if kind == "IP-ASN":
            if not parts[1].isascii() or not parts[1].isdigit() or not 0 < int(parts[1]) <= 4294967295:
                raise ValueError(f"{source}: invalid ASN: {parts[1]!r}")
        else:
            try:
                network = ipaddress.ip_network(parts[1], strict=False)
            except ValueError as error:
                raise ValueError(f"{source}: invalid CIDR: {parts[1]!r}") from error
            if network.version != (6 if kind == "IP-CIDR6" else 4):
                raise ValueError(f"{source}: IP version does not match {kind}")
    elif len(parts) != 2:
        raise ValueError(f"{source}: rule-provider entries must not contain an exit policy: {line!r}")

    if kind in DOMAIN_TYPES and (
        any(character.isspace() for character in parts[1])
        or any(character in parts[1] for character in '/:#\"\'')
    ):
        raise ValueError(f"{source}: invalid domain rule: {parts[1]!r}")
    if kind == "DOMAIN-REGEX":
        import re
        try:
            re.compile(parts[1])
        except re.error as error:
            raise ValueError(f"{source}: invalid domain regex: {error}") from error
    return ",".join(parts)


def parse_rules(text: str, source: str) -> list[str]:
    rules = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip().lstrip("\ufeff").strip()
        if line and not line.startswith("#"):
            rules.append(normalize_rule(line, f"{source}:{number}"))
    return rules


def rule_key(rule: str) -> tuple[str, ...]:
    kind, value, *_ = rule.split(",")
    if kind in {"DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD"}:
        value = value.lower()
    elif kind in {"IP-CIDR", "IP-CIDR6"}:
        value = str(ipaddress.ip_network(value, strict=False))
    elif kind == "IP-ASN":
        value = str(int(value))
    return kind, value


def fetch_rules(url: str) -> list[str]:
    request = Request(url, headers={"User-Agent": "clash-weekly-rule-sync/1.0", "Accept": "text/plain"})
    for attempt in range(1, 4):
        try:
            with urlopen(request, timeout=60) as response:
                data = response.read(MAX_SOURCE_BYTES + 1)
            if len(data) > MAX_SOURCE_BYTES:
                raise ValueError(f"Source exceeds the 10 MiB safety limit: {url}")
            rules = parse_rules(data.decode("utf-8-sig"), url)
            if not rules:
                raise ValueError(f"Source contains no rules: {url}")
            return rules
        except (OSError, HTTPException) as error:
            if isinstance(error, HTTPError) and error.code not in {408, 429, 500, 502, 503, 504}:
                raise
            if attempt == 3:
                raise
            print(f"Retry {attempt}/3: {url}: {error}", file=sys.stderr)
            time.sleep(2 ** attempt)
    raise RuntimeError("Download attempts exhausted")


def initial_header(group: str) -> bytes:
    lines = [
        f"# NAME: {group}",
        "# Classical text rules. Updates append new entries only.",
        "# Existing entries keep their order, text, and group ownership.",
        "# Sources retain their original upstream attribution:",
        *(f"# {url}" for url in SOURCES[group]),
    ]
    if group == "global":
        lines.append("# Managed custom section follows ruleset/custom_global.list, including deletions.")
    return ("\n".join(lines) + "\n").encode("utf-8")


def append_content(original: bytes, additions: list[str]) -> bytes:
    if not additions:
        return original
    newline = b"\r\n" if b"\r\n" in original else b"\n"
    separator = b"" if not original or original.endswith((b"\n", b"\r")) else newline
    encoded = newline.join(rule.encode("utf-8") for rule in additions) + newline
    return original + separator + encoded


def split_custom_section(content: bytes) -> tuple[bytes, list[str]]:
    lines = content.splitlines(keepends=True)
    begins = [index for index, line in enumerate(lines) if line.rstrip(b"\r\n") == CUSTOM_BEGIN]
    ends = [index for index, line in enumerate(lines) if line.rstrip(b"\r\n") == CUSTOM_END]
    if not begins and not ends:
        return content, []
    if len(begins) != 1 or len(ends) != 1 or begins[0] >= ends[0]:
        raise ValueError("global.list has invalid managed custom section markers; refusing to remove content")
    begin, end = begins[0], ends[0]
    custom = parse_rules(b"".join(lines[begin + 1:end]).decode("utf-8-sig"), "global.list custom section")
    return b"".join(lines[:begin] + lines[end + 1:]), custom


def plan_updates(originals: dict[str, bytes | None], candidates: dict[str, list[str]]):
    owners = {}
    counts = {}
    for group in GROUPS:
        rules = parse_rules((originals[group] or b"").decode("utf-8-sig"), f"{group}.list")
        counts[group] = len(rules)
        for rule in rules:
            key = rule_key(rule)
            if key in owners and owners[key] != group:
                print(f"Existing duplicate preserved in {owners[key]} and {group}: {rule}", file=sys.stderr)
            owners.setdefault(key, group)

    outputs = {}
    statistics = {}
    for group in GROUPS:
        additions = []
        other_groups = 0
        for rule in candidates[group]:
            key = rule_key(rule)
            if key in owners:
                other_groups += owners[key] != group
                continue
            owners[key] = group
            additions.append(rule)
        base = originals[group] if originals[group] is not None else initial_header(group)
        outputs[group] = append_content(base, additions)
        statistics[group] = (counts[group], len(additions), other_groups)
    return outputs, statistics


def plan_custom_updates(
    originals: dict[str, bytes | None],
    candidates: dict[str, list[str]],
    custom: list[str],
    custom_only: bool,
):
    baselines = dict(originals)
    body, previous_custom = split_custom_section(originals["global"] or b"")
    baselines["global"] = body if originals["global"] is not None else None

    if custom_only:
        outputs = dict(baselines)
        if outputs["global"] is None:
            outputs["global"] = initial_header("global")
        statistics = {
            group: (len(parse_rules((baselines[group] or b"").decode("utf-8-sig"), group)), 0, 0)
            for group in GROUPS
        }
    else:
        # If an upstream now provides an old custom rule, retain it permanently outside the managed section.
        upstream_keys = {rule_key(rule) for group in GROUPS for rule in candidates[group]}
        other_keys = {
            rule_key(rule)
            for group in GROUPS if group != "global"
            for rule in parse_rules((originals[group] or b"").decode("utf-8-sig"), group)
        }
        permanent_keys = {rule_key(rule) for rule in parse_rules(body.decode("utf-8-sig"), "global.list")}
        promoted = []
        for rule in previous_custom:
            key = rule_key(rule)
            if key in upstream_keys and key not in permanent_keys and key not in other_keys:
                promoted.append(rule)
                permanent_keys.add(key)
        if promoted:
            baselines["global"] = append_content(body, promoted)
        outputs, statistics = plan_updates(baselines, candidates)

    owned = {
        rule_key(rule)
        for group in GROUPS
        for rule in parse_rules((outputs[group] or b"").decode("utf-8-sig"), group)
    }
    managed = []
    skipped = 0
    for rule in custom:
        key = rule_key(rule)
        if key in owned:
            skipped += 1
            continue
        owned.add(key)
        managed.append(rule)
    outputs["global"] = append_content(
        outputs["global"] or b"",
        [CUSTOM_BEGIN.decode("ascii"), *managed, CUSTOM_END.decode("ascii")],
    )
    previous_keys = {rule_key(rule) for rule in previous_custom}
    current_keys = {rule_key(rule) for rule in managed}
    custom_statistics = (len(managed), len(current_keys - previous_keys), len(previous_keys - current_keys), skipped)
    return outputs, statistics, custom_statistics


def read_custom_snapshot() -> bytes | None:
    try:
        return CUSTOM_GLOBAL.read_bytes()
    except FileNotFoundError:
        return None


def write_updates(
    originals: dict[str, bytes | None],
    outputs: dict[str, bytes | None],
    custom_snapshot: bytes | None,
) -> None:
    changed = [group for group in GROUPS if originals[group] != outputs[group]]
    staged = {}
    try:
        for group in changed:
            content = outputs[group]
            if content is None:
                raise ValueError(f"Refusing to delete {group}.list")
            with tempfile.NamedTemporaryFile(dir=RULESET, prefix=f".{group}.", suffix=".tmp", delete=False) as temporary:
                staged[group] = Path(temporary.name)
                temporary.write(content)
        # A local edit during downloading must not be overwritten by a stale snapshot.
        for group in GROUPS:
            path = RULESET / f"{group}.list"
            current = path.read_bytes() if path.exists() else None
            if current != originals[group]:
                raise ValueError(f"{path} changed during sync; refusing to overwrite it")
        if read_custom_snapshot() != custom_snapshot:
            raise ValueError("custom_global.list changed during sync; refusing to use an outdated snapshot")
        for group in changed:
            staged[group].replace(RULESET / f"{group}.list")
    finally:
        for path in staged.values():
            path.unlink(missing_ok=True)


def sync_rules(custom_only: bool = False) -> bool:
    originals = {}
    for group in GROUPS:
        path = RULESET / f"{group}.list"
        originals[group] = path.read_bytes() if path.exists() else None
        parse_rules((originals[group] or b"").decode("utf-8-sig"), str(path))
    custom_snapshot = read_custom_snapshot()
    custom = parse_rules((custom_snapshot or b"").decode("utf-8-sig"), str(CUSTOM_GLOBAL))
    candidates = {group: [] for group in GROUPS}
    if not custom_only:
        candidates["ai"].extend(parse_rules("\n".join(AI_SEEDS), "AI_SEEDS"))
        urls = tuple(dict.fromkeys(url for group in GROUPS for url in SOURCES[group]))
        with ThreadPoolExecutor(max_workers=6) as pool:
            downloaded = dict(zip(urls, pool.map(fetch_rules, urls)))
        for group in GROUPS:
            for url in SOURCES[group]:
                candidates[group].extend(downloaded[url])
                print(f"Fetched {len(downloaded[url])} rules for {group}: {url}")
    outputs, statistics, custom_statistics = plan_custom_updates(originals, candidates, custom, custom_only)
    write_updates(originals, outputs, custom_snapshot)
    for group in GROUPS:
        previous, added, conflicts = statistics[group]
        print(f"{group}.list upstream: kept={previous}, added={added}, assigned elsewhere={conflicts}")
    count, added, removed, skipped = custom_statistics
    print(f"global.list managed custom: total={count}, added={added}, removed={removed}, duplicates skipped={skipped}")
    return any(originals[group] != outputs[group] for group in GROUPS)


def watch_custom_rules() -> None:
    last_seen = object()
    print(f"Watching {CUSTOM_GLOBAL}; press Ctrl+C to stop.")
    while True:
        snapshot = read_custom_snapshot()
        try:
            modified = CUSTOM_GLOBAL.stat().st_mtime_ns
        except FileNotFoundError:
            modified = None
        version = (snapshot, modified)
        if version != last_seen:
            # Wait briefly so editors using replace-on-save do not publish a partial edit.
            time.sleep(0.5)
            if snapshot != read_custom_snapshot():
                continue
            last_seen = version
            try:
                sync_rules(custom_only=True)
            except (OSError, UnicodeError, ValueError) as error:
                print(f"Custom sync failed; save the file again to retry: {error}", file=sys.stderr)
        time.sleep(1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Weekly upstream additions and authoritative custom rule synchronization")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--custom-only", action="store_true", help="Sync custom additions, edits, and deletions without network requests")
    mode.add_argument("--watch", action="store_true", help="Watch local custom_global.list saves and sync them without network requests")
    mode.add_argument("--migrate-only", action="store_true", help="Move legacy nested .list files directly into ruleset without changing their contents")
    args = parser.parse_args(argv)
    try:
        if args.migrate_only:
            count = migrate_rule_files()
            print(f"Migrated {count} rule files.")
        elif args.watch:
            watch_custom_rules()
        else:
            changed = sync_rules(custom_only=args.custom_only)
            print("Updated rule files." if changed else "No rule changes; all files unchanged.")
    except KeyboardInterrupt:
        print("Stopped watching custom rules.")
    except (OSError, UnicodeError, ValueError, HTTPException) as error:
        print(f"Sync failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
