#!/usr/bin/env python3
"""
PreToolUse 훅: git 에 커밋될 파일에 작성자/회사/팀 특징이 담기면 BLOCK.

룰: .claude/rules/no-identifying-info.md

스코프:
- Write / Edit / MultiEdit 대상 파일
- 해당 파일이 git repo 안에 있고 .gitignore 대상이 아닐 때만 검사
- repo 밖 또는 gitignore 대상은 skip (로컬 노트, Claude 설정, .plans/ 등)

금지 패턴은 `.claude/patterns.json` (gitignored) 에서 로드한다.
이 파일이 없으면 훅은 no-op (통과). 팀원은 레포 clone 후
`.claude/patterns.example.json` 을 참고해 자기 환경의 실제 패턴으로
`.claude/patterns.json` 을 작성한다.

Exit code:
- 0: 통과 (repo 밖, gitignored, 패턴 파일 없음, 또는 위반 없음)
- 2: BLOCK (위반 패턴 발견, stderr 에 상세 출력)
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path


def load_patterns() -> list[tuple[re.Pattern[str], str]]:
    """`.claude/patterns.json` 에서 금지 패턴을 로드. 없으면 빈 리스트.

    파일 포맷:
        {
          "patterns": [
            {"regex": "...", "description": "..."},
            ...
          ]
        }
    """
    candidates: list[Path] = []
    env_dir = os.environ.get("CLAUDE_PROJECT_DIR")
    if env_dir:
        candidates.append(Path(env_dir) / ".claude" / "patterns.json")
    # 훅 스크립트 기준 ../patterns.json 도 fallback
    candidates.append(Path(__file__).resolve().parent.parent / "patterns.json")

    for p in candidates:
        if not p.exists():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        patterns: list[tuple[re.Pattern[str], str]] = []
        for entry in data.get("patterns", []):
            regex = entry.get("regex")
            desc = entry.get("description", "")
            if not regex:
                continue
            try:
                patterns.append((re.compile(regex, re.IGNORECASE), desc))
            except re.error:
                continue
        return patterns
    return []


def extract_final_content(inp: dict) -> tuple[str, str]:
    """(tool_name, final_content) 반환. Edit/MultiEdit 는 기존 내용에 diff 적용 후 결과."""
    tool = inp.get("tool_name", "")
    ti = inp.get("tool_input", {})
    fp = ti.get("file_path", "")

    if tool == "Write":
        return tool, ti.get("content", "")

    path = Path(fp)
    current = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""

    if tool == "Edit":
        return tool, current.replace(ti.get("old_string", ""), ti.get("new_string", ""), 1)
    if tool == "MultiEdit":
        for e in ti.get("edits", []):
            current = current.replace(e.get("old_string", ""), e.get("new_string", ""), 1)
        return tool, current

    return tool, current


def is_in_git_repo(file_path: str) -> bool:
    path = Path(file_path)
    parent = str(path.parent if path.parent.exists() else Path.cwd())
    try:
        result = subprocess.run(
            ["git", "-C", parent, "rev-parse", "--is-inside-work-tree"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        return result.returncode == 0 and result.stdout.strip() == "true"
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def is_gitignored(file_path: str) -> bool:
    path = Path(file_path)
    parent = str(path.parent if path.parent.exists() else Path.cwd())
    try:
        result = subprocess.run(
            ["git", "-C", parent, "check-ignore", "-q", file_path],
            capture_output=True,
            text=True,
            timeout=3,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def scan_violations(
    content: str,
    patterns: list[tuple[re.Pattern[str], str]],
) -> list[tuple[int, str, str]]:
    violations: list[tuple[int, str, str]] = []
    for lineno, line in enumerate(content.splitlines(), 1):
        for pat, desc in patterns:
            if pat.search(line):
                violations.append((lineno, line.rstrip(), desc))
                break
    return violations


def main() -> None:
    try:
        inp = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    fp = inp.get("tool_input", {}).get("file_path", "")
    if not fp:
        sys.exit(0)

    if not is_in_git_repo(fp):
        sys.exit(0)
    if is_gitignored(fp):
        sys.exit(0)

    patterns = load_patterns()
    if not patterns:
        # 팀원이 아직 .claude/patterns.json 을 작성하지 않은 상태. no-op.
        sys.exit(0)

    _tool, content = extract_final_content(inp)
    violations = scan_violations(content, patterns)
    if not violations:
        sys.exit(0)

    seen_desc: set[str] = set()
    unique: list[tuple[int, str, str]] = []
    for v in violations:
        if v[2] not in seen_desc:
            seen_desc.add(v[2])
            unique.append(v)

    msg = [
        f"작성자/회사 특징 노출 감지: {fp}",
        "",
    ]
    for lineno, line, desc in unique:
        msg.append(f"  {lineno}: {line}  [{desc}]")
    msg += [
        "",
        "룰: .claude/rules/no-identifying-info.md",
        "- git 에 커밋되는 파일에는 사내 도메인/팀명/실명/내부 호스트명 등을 남기지 않는다",
        "- 대체 표현 사용 (예: host1, server-01, user@example.com)",
        "- 실제 값이 꼭 필요하면 .gitignore 대상 파일로 옮기거나, 예제용 placeholder 로 대체",
        "- 패턴 정의는 .claude/patterns.json (gitignored) 에서 관리",
    ]
    print("\n".join(msg), file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
