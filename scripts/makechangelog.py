#!/usr/bin/env python3
"""Add a release to CHANGELOG.md from the pull requests merged since the last release.

    python3 scripts/makechangelog.py 0.3.0              # writes CHANGELOG.md
    python3 scripts/makechangelog.py 0.3.0 --dry-run    # prints it instead

Every change reaches develop through a pull request, so the merge commits on the
first-parent line since the last release (origin/main) are the list of what shipped.
Each entry is the pull request's title with the subjects of its commits underneath,
grouped by branch prefix: feat/ under Features, fix/ under Fixes, the rest under
Maintenance. Run it on the release branch, then commit CHANGELOG.md there.
"""

import argparse
import datetime
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHANGELOG = REPO / "CHANGELOG.md"
HEADER = "# Changelog\n"
MERGE = re.compile(r"^Merge pull request #(?P<number>\d+) from [^/]+/(?P<branch>\S+)$")
SECTIONS = {"feat": "Features", "fix": "Fixes"}
OTHER = "Maintenance"


@dataclass
class Entry:
    number: int
    branch: str
    title: str
    commits: list[str] = field(default_factory=list)

    @property
    def section(self) -> str:
        return SECTIONS.get(self.branch.split("/")[0], OTHER)


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, check=True, capture_output=True, text=True).stdout


def clean_title(title: str) -> str:
    """'Feat/organisation positions' (GitHub's default from the branch) -> 'Organisation positions'."""
    text = re.sub(r"^(feat|fix|chore|test|docs|refactor)/", "", title.strip(), flags=re.IGNORECASE)
    text = text.replace("-", " ")
    return text[:1].upper() + text[1:]


def merged_pull_requests(since: str, until: str) -> list[Entry]:
    """Pull requests merged into `until` since `since`, oldest first; release merges left out."""
    log = git("log", "--merges", "--first-parent", "--reverse", "--format=%H%x00%P%x00%s%x00%b%x1e", f"{since}..{until}")
    entries = []
    for record in filter(str.strip, log.split("\x1e")):
        _, parents, subject, body = record.strip().split("\x00")
        match = MERGE.match(subject)
        if match and not match["branch"].startswith("release/"):
            first, second = parents.split()[:2]
            commits = git("log", "--no-merges", "--reverse", "--format=%s", f"{first}..{second}").split("\n")
            title = body.strip().split("\n")[0] or match["branch"].split("/", 1)[-1]
            entries.append(Entry(int(match["number"]), match["branch"], clean_title(title), [c for c in commits if c]))
    return entries


def repository_url() -> str:
    """https://github.com/<owner>/<repo>, from the origin remote (SSH or HTTPS)."""
    remote = git("remote", "get-url", "origin").strip()
    path = re.sub(r"^(git@github\.com:|https://github\.com/)", "", remote).removesuffix(".git")
    return f"https://github.com/{path}"


def render(version: str, date: str, entries: list[Entry], url: str) -> str:
    lines = [f"## {version} ({date})", ""]
    for section in [*SECTIONS.values(), OTHER]:
        chosen = [e for e in entries if e.section == section]
        if chosen:
            lines += [f"### {section}", ""]
            for e in chosen:
                lines.append(f"- **{e.title}** ([#{e.number}]({url}/pull/{e.number}))")
                lines += [f"  - {commit}" for commit in e.commits]
            lines.append("")
    return "\n".join(lines)


def prepend(section: str, existing: str) -> str:
    """Put the new release first, under the title."""
    rest = existing.removeprefix(HEADER).lstrip("\n")
    return f"{HEADER}\n{section}\n{rest}".rstrip("\n") + "\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Add a release to CHANGELOG.md.")
    parser.add_argument("version", help="The release, e.g. 0.3.0")
    parser.add_argument("--since", default="origin/main", help="The last release (default: origin/main)")
    parser.add_argument("--until", default="HEAD", help="What is being released (default: HEAD)")
    parser.add_argument("--dry-run", action="store_true", help="Print the section instead of writing it")
    args = parser.parse_args(argv)

    existing = CHANGELOG.read_text() if CHANGELOG.exists() else HEADER
    if f"## {args.version} " in existing:
        sys.exit(f"CHANGELOG.md already has {args.version}.")
    entries = merged_pull_requests(args.since, args.until)
    if not entries:
        sys.exit(f"No pull requests were merged between {args.since} and {args.until}.")
    section = render(args.version, datetime.date.today().isoformat(), entries, repository_url())
    if args.dry_run:
        print(section)
    else:
        CHANGELOG.write_text(prepend(section, existing))
        print(f"Added {args.version} to CHANGELOG.md: {len(entries)} pull requests.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
