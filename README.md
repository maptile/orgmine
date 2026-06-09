# orgmine

A local-first Redmine issue manager for Emacs. Issues are stored as org-mode files on disk, letting you write and edit locally, then submit to Redmine. The local copies also serve as a searchable archive.

## How it works

Each issue is stored as a `.org` file. Metadata (ID, status, priority, version, etc.) is kept in `#+KEYWORD` headers at the top of the file — names only, no numeric IDs. The description is stored inside a `#+BEGIN_SRC textile` (or `markdown`) block so Emacs provides proper syntax highlighting.

```org
#+TITLE: Fix login timeout bug
#+REDMINE_INSTANCE: work
#+REDMINE_ID: 234
#+REDMINE_PROJECT: my-project
#+REDMINE_STATUS: New
#+REDMINE_PRIORITY: High
#+REDMINE_ASSIGNED_TO: Jane
#+REDMINE_VERSION: Sprint 4
#+REDMINE_CATEGORY: Backend
#+REDMINE_MARKUP: textile
#+REDMINE_LOCK_VERSION: 2
#+REDMINE_UPDATED_ON: 2026-06-08T10:00:00Z
#+REDMINE_CREATED_ON: 2026-05-01T09:00:00Z

#+BEGIN_SRC textile
  h2. Steps to reproduce

  * Open the login page
  * Leave the tab idle for 30 minutes
  * Try to submit the form

  h2. Expected result

  Session should refresh automatically.
#+END_SRC
```

When submitting, field names are resolved to numeric IDs from the local cache (see `refresh`). Edit conflict detection relies on Redmine's built-in `lock_version` field. If someone else updates the issue between your fetch and your submit, Redmine returns a 409 and `orgmine` tells you exactly what to do.

## Requirements

- Node.js 18+
- A Redmine instance with API access
- Emacs with `textile-mode` (or `markdown-mode`) and `org-src-fontify-natively` set to `t`

## Installation

```bash
git clone <repo>
cd orgmine
npm install
npm install -g .   # makes the `orgmine` command available globally
```

## Configuration

Create the config file:

```bash
orgmine init
```

`~/.config/orgmine/config.json`:

```json
{
  "default": "work",
  "instances": {
    "work": {
      "server": "https://redmine.yourcompany.com",
      "apiKey": "your-api-key-here",
      "localDir": "~/redmine-issues/work",
      "markup": "textile",
      "statusOrder": ["new", "confirmed", "assigned", "InProgress", "resolved", "verified", "deferred", "closed", "rejected", "cancelled", "reopened"],
      "highlightRejected": true,
      "highlightReopened": true,
      "reopenedAsAssigned": false,
      "categories": [
        { "id": 1, "name": "UI" },
        { "id": 2, "name": "Backend" }
      ],
      "templates": {
        "defect": "~/.config/orgmine/templates/defect.org",
        "feature": "~/.config/orgmine/templates/feature.org"
      }
    }
  }
}
```

| Field | Required | Description |
|---|---|---|
| `server` | yes | Redmine base URL |
| `apiKey` | yes | Your Redmine API key (profile → API access key) |
| `localDir` | yes | Directory where org files are stored |
| `markup` | no | `textile` (default) or `markdown` |
| `statusOrder` | no | Display order for status groups in `list` |
| `highlightRejected` | no | Highlight rejected issues in red (default `false`) |
| `highlightReopened` | no | Highlight reopened issues in red (default `false`) |
| `reopenedAsAssigned` | no | Group reopened issues under Assigned (default `false`) |
| `categories` | no | Static list of `{id, name}` pairs used when the API returns 403 for categories |
| `templates` | no | Map of issue type → template org file path. Supported keys: `defect`, `feature`. Paths support `~/`. |

All fields can be overridden per-command with CLI options (see below). If you supply `--server`, `--api-key`, and `--local-dir` on the command line, the config file is not required.

## Commands

### `refresh` — update local lookup cache

```bash
orgmine refresh
orgmine -i personal refresh
```

Fetches statuses, priorities, projects, and per-project members and versions from Redmine and saves them to `~/.config/orgmine/cache.json`. Run this once after setup, and again whenever your Redmine configuration changes. `submit` warns you if the cache is older than one week.

### `list` — browse issues grouped by status

```bash
orgmine list -p <project> -v <version>
orgmine list -p myproject -v "Sprint 4"
orgmine -i personal list -p other-project
```

Options:

| Flag | Description |
|---|---|
| `-p, --project` | Filter by project name or identifier |
| `-v, --version` | Filter by version name (requires `--project`) |
| `--highlight-rejected` / `--no-highlight-rejected` | Override config |
| `--highlight-reopened` / `--no-highlight-reopened` | Override config |
| `--reopen-as-assigned` / `--no-reopen-as-assigned` | Override config |

Issues cached locally are marked with `★`.

### `fetch` — download an issue to a local file

```bash
orgmine fetch 234
orgmine -i personal fetch 99
```

Saves to `<localDir>/<project>/<id>-<slug>.org`. If the file already exists it is overwritten (this is how you refresh after a conflict).

### `sync` — download all issues

```bash
orgmine sync
orgmine sync -p myproject
orgmine sync -p myproject -v "Sprint 4"
orgmine sync --force   # overwrite existing local files
```

Downloads all issues (all statuses) to local org files. Skips files that already exist unless `--force` is passed.

### `new` — create a local draft

```bash
orgmine new -p myproject -t "Fix login timeout" -v "Sprint 4"
```

Prompts interactively for:
- **Project** — if `-p` is not supplied
- **Type** — `defect` or `feature` (selects the template)
- **Assignee**, **Category**, **Version** — fetched from Redmine; empty fields only

If a template org file is configured for the chosen type, its title, status, priority, and description are used as the starting content. Open the draft in Emacs, fill in the description, then submit.

### `submit` — push a local file to Redmine

```bash
orgmine submit 234                  # find file by issue ID, show diff, confirm
orgmine submit ./path/to/file.org   # submit directly, still confirms
orgmine submit 234 --force          # skip conflict detection
```

Both input forms ask for confirmation. When updating an existing issue, `submit` first fetches the current server state and shows a diff so you can review what will change. If there are no changes, it exits without asking.

- If `#+REDMINE_ID` is absent → creates a new issue, then renames the file with the assigned ID.
- If `#+REDMINE_ID` is present → updates the existing issue using `lock_version` for conflict detection.
- Field names (status, priority, etc.) are resolved to IDs from the local cache before submission.
- On conflict: shows instructions to re-fetch or use `--force`.

### `fields` — discover custom field IDs

```bash
orgmine fields 234
```

Prints all custom fields on the given issue with their IDs.

## Global options

```bash
orgmine -i <instance>       # select a named instance from config
orgmine --server <url>      # override server URL
orgmine --api-key <key>     # override API key
orgmine --local-dir <path>  # override local directory
```

When `--server`, `--api-key`, and `--local-dir` are all provided, the config file is not read at all.

## Local directory layout

```
~/redmine-issues/
  work/
    my-project/
      234-fix-login-timeout.org
      241-add-export-feature.org
    other-project/
      789-some-issue.org
    _drafts/
      new-2026-06-08T10-30-00.org
```

## Emacs setup

Add to your Emacs config:

```elisp
(setq org-src-fontify-natively t)
```

Install `textile-mode` from MELPA if your Redmine uses Textile markup:

```
M-x package-install RET textile-mode RET
```

For Markdown, `markdown-mode` is already widely available.

## Credits

This project was written by [Claude](https://claude.ai) (claude-sonnet-4-6), Anthropic's AI assistant.
