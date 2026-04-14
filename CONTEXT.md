# EAR Explorer / EAR Tester — Session Context

> **Standing rule (set 2026-04-13):**
> After every user prompt, update this file with new learnings and commit+push to GitHub.
> This file is the canonical "start-over" document for any new agent session.

---

## Ports
| App | Port |
|---|---|
| EAR Explorer | 9000 |
| EAR Tester | 9001 |

## Key Files
| File | Purpose |
|---|---|
| `server.js` | Express server for both apps (single process, two ports) |
| `public/index.html` | EAR Explorer UI |
| `public/tester.html` | EAR Tester UI |
| `_vtree.ps1` | Win32 window tree enumerator for VirtTerm |
| `CONTEXT.md` | This file — updated on every prompt, committed to GitHub |

## Servers & DB
- `ArcadiaWHJSqlStage` (default) · `RetailRHjsqldev` · `RetailRHjsqlStage`
- DB: `EAR` (mssql/msnodesqlv8, Windows auth, ODBC)
- ADV schema also used: `ADV.dbo.t_device`, `ADV.dbo.t_menu`, `ADV.dbo.t_solution`
- AAD schema: `AAD.dbo.t_menu` (used for dynamic menu BFS)

---

## EAR DB Schema — Action Type Table Map

The `t_app_process_object_detail.action_type` column determines which detail table to join.
All types except Constant have a `name` and `description` column.

| action_type | Name | Table | Detail Table | Notes |
|---|---|---|---|---|
| 1 | Process | `t_app_process_object` | — | Drill into subprocess steps |
| 3 | Calculate | `t_act_calculate` | `t_act_calculate_detail` | Formula steps |
| 4 | Compare | `t_act_compare` | — | Operand1 op Operand2 |
| 5 | Database | `t_act_database` | `t_act_database_detail` | SQL statement (GUID placeholders) |
| 6 | Dialog | `t_act_dialog` | `t_act_dialog_detail` | Screen fields + screen layout |
| 7 | Execute | `t_act_execute` | — | name, description |
| 9 | List | `t_act_list` | — | name, operator, operands |
| 10 | Publish | `t_act_publish` | — | name, description |
| 11 | Receive | `t_act_receive` | — | name, description |
| 12 | Report | `t_act_report` | — | name, description |
| 13 | Send | `t_act_send` | — | name, description |
| 14 | User | `t_act_user` | — | name, description |
| 16 | Locale | `t_app_locale` | — | name, description |
| 17 | Field | `t_app_field` | — | name, description |
| 18 | Constant | `t_app_constant` | — | data_string / data_number / data_datetime |
| 19 | Record | `t_app_record` | — | name, description |
| -1 | Comment | — | — | commented_out=1 rows |

**GUID placeholders** in DB statement fields look like `:#17#<GUID>#:` (type 17=Field, 19=Record).
`resolveGuids()` in server.js replaces these with readable names.

**DETAIL_COLS / DETAIL_JOINS** in server.js are the canonical SQL fragments used for
all process step fetches. They LEFT JOIN every action table and COALESCE the `name`.

---

## Features Built (cumulative)

### EAR Explorer — Navigation & Display
- **Route fixes** (early session): renamed all `/api/db|compare|calc|list|dialog` → `-action` suffix.
- **HTML encoding**: `esc2()` applied to all detail panel fields.
- **Right-click copy path**: context menu on every step row.
  Format: `FromProcess → StepLabel → NextProcess → … → ClickedAction`
  `navStack` stores `{ backLabel, navLabel }` — `navLabel` = `r.label` clicked to drill.

### EAR Explorer — "Who calls this?" (Reverse BFS)
- **Endpoint**: `GET /api/explorer/all-paths?id=<processId>&app=<app>&server=<server>`
- Uses `getGraph()` cached adjacency; builds reverse adjacency (child→parents), BFS backwards.
- Returns: `[{ id, name, path, depth, isRoot }]` sorted by depth.
- `path` = full chain: `EntryPoint → … → TargetProcess`
- UI: clicking "👥 Who calls this?" on a group header opens a full paths table.
- **📋 Copy button**: next to "👥 Who calls this?" on every group header.
  Click → silently fetches all paths → copies one-path-per-line to clipboard → shows ✓.
  No navigation required.

### EAR Explorer — Drill Into All Action Types
- **All 16 action types** now open a detail panel on click.
- **Click behaviour (row onclick):**
  - Process (type 1): click action-name cell only → `drillInto()` navigates into subprocess.
    Clicking elsewhere on the row shows the basic step metadata panel.
  - All other types: clicking **anywhere on the row** opens the type-specific detail panel.
  - Pass/Fail label-link spans are exempt (`e.target.closest('.label-link')`) so navigation still works.
- Types 1/3/4/5/6/9 have specific handlers (drillInto / showCalcDetail / etc).
- Types 7/10/11/12/13/14/16/17/18/19 use **`showGenericDetail(r, tr)`**:
  - Calls `GET /api/generic-action/:type/:id`
  - Server looks up `ACTION_TYPE_TABLES[type]` → correct table + columns
  - Renders name, description, and any extra fields in the side panel
  - Emoji per type: ⚡Execute 📤Publish 📥Receive 📊Report 📨Send 👤User 🌐Locale 🔧Field 🔒Constant 📋Record

### EAR Explorer — "📋 Copy Paths" in the Detail Panel (any action type)
Every detail panel (Calculate, Compare, Database, Dialog, List, Execute, etc.) now has a
**"📋 Copy Paths to this action"** button appended after the content loads.

- **Right-click context menu** (replaces former detail-panel button, which was removed):
  - Right-click any **group header row** → "🗺 Copy all entry-point paths" → `fetchCopyProcessPaths`
  - Right-click any **action step row** → same item; type=1 calls `fetchCopyProcessPaths(action_id)`,
    all other types call `fetchCopyActionPaths(action_type, action_id)`
  - Right-click any **process list item** (search results) → `fetchCopyProcessPaths`
  - `fetchCopyProcessPaths(procId, name)` → `GET /api/explorer/all-paths`, filters `isRoot`, copies
  - `fetchCopyActionPaths(type, id, name)` → `GET /api/action-paths`, copies root paths
  - `showCtxMenu(x, y, path, allPathsFn)` — separator + "🗺" item hidden when `allPathsFn` is null
  - `showToast(msg, ms)` — shared toast helper
  - `/api/action-paths` returns ONLY root nodes. Initial bug emitted every BFS ancestor (39k lines).
- **`copyCallerPaths`** (group header 📋 button) filters `paths.filter(p => p.isRoot)` before copying

> **Bug note:** Initial implementation emitted every BFS ancestor node as a separate result row.
> For a process with many ancestors this produced tens of thousands of lines. The fix is to
> emit only root nodes (no reverse-adjacency parents). Each root's `path` string already contains
> the complete chain from entry point to the containing process.

### EAR Tester — Reachable Dialogs (BFS)
- Call graph cached per `server|app` key (15 min TTL). First load ~1 s; switches <10 ms.
- `getGraph(server, app)` returns `{ adjacency, nameOf, dialogIds }`.
- Dynamic `_`-prefixed menus injected as virtual BFS nodes (`MENU:_Name`).
  Found via `t_act_database_detail.statement LIKE '%t_menu%'` (Q3/Q4).
- Grid: 637 dialogs + 14 dynamic menu rows; menu rows show `t_menu.text` items.

### EAR Tester — Launch VirtTerm
- **Button**: green `🖥 VirtTerm` in Tester header → calls `POST /api/launch-virtterm`.
- **Endpoint**: spawns `C:\Users\PVenkatesh\Downloads\VirtualScanner\x86\VirtTerm.exe` detached.
- VirtTerm connects using its pre-configured registry/AppData settings.

---

## Git Commit Log (recent)
| Hash | Summary |
|---|---|
| `(latest)` | fix: add all missing action types to search dropdown; add missing SQL clauses for 10/12/16/17/18/19 |
| `75db452` | feat: right-click Copy all entry-point paths on any row; remove detail panel button |
| `dab2937` | fix: copy-paths only emits root entry-point paths; was emitting all 39k ancestors |
| `f92f9d5` | feat: Copy Paths for any action type in detail panel; fix row click; /api/action-paths |
| `bbdf90a` | docs: update CONTEXT.md with schema map, all features, commit log, standing rule |
| `1236ac4` | feat: drill into all action types (Execute/Send/Receive/Report/etc); copy-paths clipboard button |
| `164b581` | feat: Explorer 'Who calls this?' reverse BFS for all paths |
| `8c21c6a` | feat: launch VirtTerm button; _vtree.ps1; CONTEXT.md session notes |

---

## VirtTerm Win32 Window Hierarchy

```
VirtTerm.exe  (PID varies)
+-- [H] #32770  "Virtual Terminal Configuration"
|       +-- [H] Edit [ID=1000]  ← Host Server Name  (e.g. "172.26.161.132")
|       +-- [H] Edit [ID=1001]  ← Host Port Number  (e.g. "4400")
|       +-- [H] Edit [ID=1002]  ← Device Name       (e.g. "WAVTUAT10")
|       +-- [H] Button [ID=1]   "&OK"
|       +-- [H] Button [ID=2]   "&Cancel"
|       +-- [H] Static x3       "Host Server Name:" / "Host Port Number:" / "Device Name:"
+-- [V] ADV_Virtual_Terminal  "Advantage Virtual Terminal"
|       L__ [V] ScrnClass  "Advantage Virtual Terminal"
|               +-- [H] Edit  "ConsoleEcho"   ← FULL SCREEN TEXT (all rows, hidden)
|               +-- [V] Button [ID=903-914]   F1 … F12
|               L__ [H] ScrollBar [ID=924]
+-- [H] MSCTFIME UI
L__ [H] IME  "Default IME"
```

### Key facts
- **All screen text** lives in the single hidden `Edit "ConsoleEcho"` control.
  Read via `WM_GETTEXT` (buffer 4096 chars). `ScrnClass` custom-paints it.
- **Config dialog** (`#32770`) is Hidden — VirtTerm connects on startup using
  whatever is in the Edit fields. To switch server: show dialog, set [ID=1000/1001/1002],
  click OK [ID=1].
- **To send keystrokes**: `WM_CHAR` / `PostMessage` to `ScrnClass` or `ConsoleEcho`.
- **`_vtree.ps1`**: PowerShell script in repo root that enumerates the full window
  tree with control IDs, visibility, and Edit content.

---

---

## Demo-Critical Fixes (applied after 0-2 demo failure)

### Fix 1 — Clipboard API on HTTP/IP access
`navigator.clipboard.writeText()` requires HTTPS or localhost. On a LAN IP demo the API is undefined → TypeError.
**Fix:** `writeToClipboard(text)` helper tries `navigator.clipboard` first, falls back to `textarea + execCommand('copy')`.
All 4 call sites replaced. Located around line 1265 in index.html.

### Fix 2 — Search result click: scroll to and flash matched action
Clicking a Calculate/Compare/Field (etc.) search result opened the parent process at the top with no indication of which step matched. Looked broken.
**Fix:** `openProcess(processId, processName, pushToStack, targetActionName)` — 4th param added.
- After `renderTable()`, scans all `tr.detail-row` for `td.action-name` matching the target (case-insensitive partial match).
- Expands the group if it was collapsed (calls `toggleGroup`).
- Adds `search-match` CSS class → purple flash animation for 2 s.
- Scrolls to the first match with `scrollIntoView({ behavior:'smooth', block:'center' })`.
`renderProcessList` click handler updated: passes `p.action_name` for non-process results, null for process results.

### Fix 3 — Search dropdown duplicates
Previous edit left duplicate entries (Execute, List, Receive, Send, User appeared twice). Fixed in de9e31f.

## Pending / Next Steps

### VirtTerm Screen Recorder (NOT YET BUILT)
As you navigate VirtTerm screens, record the full `ConsoleEcho` text at each step
so future runs can validate against it.

**Proposed design:**
- `POST /api/vt/screen` — reads ConsoleEcho via inline PowerShell + Win32, returns `{screen}`
- `POST /api/vt/recording` — saves `{name, steps:[{label, screen}]}` → `recordings/{name}.json`
- `GET  /api/vt/recording/:name` — loads a recording
- `GET  /api/vt/recordings` — lists saved recordings
- **Tester UI**: "🔴 Record" button → label input + "📸 Capture" + "⏹ Stop"
- **Compare mode**: load recording → navigate → auto-diff actual vs expected per step

### Dynamic Menu Downstream Links
`t_menu.text` items may link to real process objects via another table (`t_task`?).
Confirm the table and we can extend the BFS to show full paths through menu items.

### Automated VirtTerm Connection
Use Win32 control IDs discovered in `_vtree.ps1` to auto-configure VirtTerm on launch:
show hidden `#32770` dialog → set ID=1000 (host), ID=1001 (port), ID=1002 (device) → click OK (ID=1).
