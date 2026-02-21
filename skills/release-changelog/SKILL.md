---
name: release-changelog
description: Keep CHANGELOG.md idiomatic (Keep a Changelog) and cut a tag-based GitHub release that triggers npm publish CI.
kind: sop
---

# Release + CHANGELOG Workflow

## Overview

Use this SOP to run a clean release process for rho:

1. maintain an idiomatic `CHANGELOG.md` (Keep a Changelog + SemVer),
2. ensure `package.json` version, git tag, and changelog section match,
3. publish a GitHub Release from changelog notes,
4. let CI publish npm from the release event.

This SOP is designed for the existing workflow in `.github/workflows/publish.yml` (`release.published` trigger).

## Parameters

- **version** (required): SemVer version without `v` prefix (example: `0.1.8`)
- **date** (optional, default: current UTC date `YYYY-MM-DD`): Release date for changelog header
- **changelog_path** (optional, default: `CHANGELOG.md`): Path to changelog file
- **release_branch** (optional, default: `main`): Branch to release from
- **run_tests** (optional, default: `true`): Run validation tests before release
- **create_github_release** (optional, default: `true`): Create GitHub Release with notes from changelog
- **push_tag_and_branch** (optional, default: `false`): Push branch/tag after explicit confirmation

## Steps

### 1. Gather release inputs

Confirm version/date and whether this is a stable release.

**Constraints:**
- You MUST validate `version` as SemVer (`X.Y.Z`)
- You MUST derive `tag` as `v{version}`
- You MUST confirm risky external actions before executing them:
  - pushing to remote
  - creating GitHub Release

### 2. Preflight repository state

Verify the local repository is safe to release.

**Constraints:**
- You MUST verify working tree is clean (`git status --short`)
- You MUST verify current branch matches `{release_branch}`
- You MUST fetch tags and remote state before release (`git fetch --tags origin`)
- You MUST fail fast if `tag` already exists locally or on origin
- You MUST verify `gh auth status` succeeds before attempting release creation

### 3. Ensure idiomatic changelog structure

Create/normalize `CHANGELOG.md` using Keep a Changelog format.

**Constraints:**
- If `{changelog_path}` does not exist, you MUST create it with:
  - `# Changelog`
  - intro lines for Keep a Changelog + SemVer
  - `## [Unreleased]`
  - compare-link section at file bottom
- You MUST keep section format exactly:
  - `## [Unreleased]`
  - `## [{version}] - {date}`
- You SHOULD use standard subsections where applicable:
  - `### Added`
  - `### Changed`
  - `### Fixed`
  - `### Removed`
  - `### Security`
- You MUST move release-ready content from `Unreleased` into `[{version}]`
- You MUST update compare links at bottom:
  - `[Unreleased]: ...compare/{tag}...HEAD`
  - `[{version}]: ...compare/{previous_tag}...{tag}` (or repo root page for first release)

### 4. Validate version contract

Validate the release contract expected by CI.

**Constraints:**
- You MUST verify `package.json` version equals `{version}`
- You MUST verify changelog contains `## [{version}] - {date}`
- You MUST verify changelog section for `{version}` is non-empty
- If `{run_tests}=true`, you MUST run project test gates before tagging
- You MUST NOT proceed to tag/release when any validation fails

### 5. Commit release metadata

Commit version/changelog updates before tagging.

**Constraints:**
- You MUST stage only intended release files (at minimum `CHANGELOG.md`, plus version bumps)
- You MUST use a conventional release commit message, recommended:
  - `chore(release): v{version}`
- You MUST verify commit succeeds before continuing

### 6. Create tag

Create the release tag from the release commit.

**Constraints:**
- You MUST create annotated tag `v{version}`
- You MUST verify tag points to the release commit (`git show v{version} --no-patch`)

### 7. Push and create GitHub release

Push release artifacts and create release notes from changelog.

**Constraints:**
- You MUST ask for explicit confirmation before push/release actions
- If `{push_tag_and_branch}=true`, you MUST push branch and tag to origin
- If `{create_github_release}=true`, you MUST create GitHub Release with notes from `{version}` changelog section
- You MUST ensure release title matches tag (`v{version}`)
- You SHOULD use `--verify-tag` when creating the GitHub Release

Suggested command shape:

```bash
gh release create "v{version}" \
  --title "v{version}" \
  --notes-file /tmp/release-notes-v{version}.md \
  --verify-tag
```

### 8. Post-release verification

Confirm CI and package publication status.

**Constraints:**
- You MUST verify GitHub release exists for `v{version}`
- You MUST verify Publish workflow started/completed
- You SHOULD verify npm version after publish:
  - `npm view @rhobot-dev/rho version`
- You MUST report final status with links to tag, release, and workflow run

## Output

When complete, report:

- released version/tag
- commit hash
- changelog path updated
- GitHub release URL
- publish workflow URL/status
- npm version observed

## Troubleshooting

- **`package.json` mismatch with tag**: update version and re-commit before creating release
- **Tag already exists**: stop and decide whether to bump version or intentionally re-release
- **Release created but npm not published**: check `publish.yml` run logs and npm environment permissions
- **Empty release notes**: extract notes from the matching `## [{version}]` section only
