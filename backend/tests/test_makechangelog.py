"""scripts/makechangelog.py, the release changelog writer (a plain script, not part of the app)."""

import datetime
import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "makechangelog.py"
spec = importlib.util.spec_from_file_location("makechangelog", SCRIPT)
makechangelog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(makechangelog)


def record(sha, subject, body=""):
    return f"{sha}\x00{sha}1 {sha}2\x00{subject}\x00{body}\x1e"


LOG = "".join([
    record("a", "Merge pull request #29 from Org/feat/hackathon-participation", "Feat/hackathon participation\n"),
    record("b", "Merge pull request #30 from Org/chore/ci-cache"),
    record("c", "Merge pull request #31 from Org/release/0.2.0", "Release"),
    record("d", "Merge branch 'develop' into feat/x"),
])
COMMITS = {"a1..a2": "Register first\nThen find a team\n", "b1..b2": ""}


@pytest.fixture
def changelog(monkeypatch, tmp_path):
    """Canned git answers and a CHANGELOG.md in a temporary folder."""

    def git(*args):
        if args[0] == "remote":
            return "git@github.com:Org/community.git\n"
        return LOG if "--merges" in args else COMMITS[args[-1]]

    monkeypatch.setattr(makechangelog, "git", git)
    monkeypatch.setattr(makechangelog, "CHANGELOG", tmp_path / "CHANGELOG.md")
    return tmp_path / "CHANGELOG.md"


def test_it_writes_the_release_from_the_pull_requests_merged_since_the_last_one(changelog):
    assert makechangelog.main(["0.3.0"]) == 0
    assert changelog.read_text() == f"""# Changelog

## 0.3.0 ({datetime.date.today().isoformat()})

### Features

- **Hackathon participation** ([#29](https://github.com/Org/community/pull/29))
  - Register first
  - Then find a team

### Maintenance

- **Ci cache** ([#30](https://github.com/Org/community/pull/30))
"""


def test_each_release_goes_first_and_only_once(changelog):
    changelog.write_text("# Changelog\n\n## 0.2.0 (2026-11-22)\n\n- Older things\n")
    makechangelog.main(["0.3.0"])
    assert changelog.read_text().startswith("# Changelog\n\n## 0.3.0 (")
    assert changelog.read_text().endswith("## 0.2.0 (2026-11-22)\n\n- Older things\n")
    with pytest.raises(SystemExit, match="already has 0.3.0"):
        makechangelog.main(["0.3.0"])


def test_a_dry_run_only_prints(changelog, capsys):
    makechangelog.main(["0.3.0", "--dry-run"])
    assert capsys.readouterr().out.startswith("## 0.3.0 (")
    assert not changelog.exists()


def test_nothing_merged_means_no_release(changelog, monkeypatch):
    monkeypatch.setattr(makechangelog, "git", lambda *args: "")
    with pytest.raises(SystemExit, match="No pull requests were merged between origin/main and HEAD."):
        makechangelog.main(["0.3.0"])
