# EAR Explorer / EAR Tester — Session Context

> **Standing rule (set 2026-04-13):**
> After every user prompt, update this file with new learnings and commit+push to GitHub.
> This file is the canonical "start-over" document for any new agent session.

---

## Repository Layout

| Repo | Path | Purpose |
|---|---|---|
| `ear-explorer` | `C:\Users\PVenkatesh\Downloads\ear-explorer` | Main repo — Node server + both UIs |
| `ear-tester` | `C:\Users\PVenkatesh\Downloads\ear-tester` | Separate repo — PowerShell test runner |
| VirtTerm | `C:\Users\PVenkatesh\Downloads\VirtualScanner\x86\VirtTerm.exe` | Advantage terminal emulator |

### ear-explorer key files
| File | Purpose |
|---|---|
| `server.js` | Single Express process serving both ports 9000 and 9001 |
| `public/index.html` | EAR Explorer UI (port 9000) |
| `public/tester.html` | EAR Tester UI (port 9001) |
| `CONTEXT.md` | This file — committed on every prompt |
| `_vtree.ps1` | Win32 window tree enumerator — run to dump VirtTerm control IDs |
| `register-task.ps1` | Task Scheduler auto-startup for server |
| `Start-EARExplorer.ps1` | Manual startup script |

### ear-tester key files
| File | Purpose |
|---|---|
| `Run-Tests.ps1` | Entry point — params: `-BaseUrl`, `-Server`, `-App`, `-EntryPoint`, `-DeviceId`, `-VirtTerm` |
| `tests/VirtTerm.ps1` | Win32 controller: launch/find/read/send for VirtTerm.exe |
| `tests/virtterm-tests.ps1` | Test cases: Launch, Logon, Scan simulation, Screen wait, Teardown |
| `_json_log.txt` | Written by Run-Tests.ps1 after each run; read by `/api/tests/results` |
| `lib/` | Shared helpers dot-sourced by Run-Tests.ps1 |
| `tools/` | Utility scripts |

---

## Ports & Servers

| App | Port | URL |
|---|---|---|
| EAR Explorer | 9000 | http://localhost:9000 |
| EAR Tester | 9001 | http://localhost:9001 |

**DB servers (all SQL Server, Windows auth, ODBC):**
- `ArcadiaWHJSqlStage` (default / demo)
- `RetailRHjsqldev`
- `RetailRHjsqlStage`

**Schemas used:**
- `EAR` — main application DB (all `t_app_*`, `t_act_*` tables)
- `ADV.dbo.t_device`, `ADV.dbo.t_menu`, `ADV.dbo.t_solution`
- `AAD.dbo.t_menu` — dynamic menu BFS

---

## API Endpoints (server.js)

### EAR Explorer (port 9000)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/search` | Search processes/actions. Params: `process`, `application`, `scope` (comma-joined type IDs), `server` |
| GET | `/api/process/:id` | All steps for a process. Params: `application`, `server` |
| GET | `/api/explorer/all-paths` | Reverse BFS from a process to all entry points. Params: `id`, `app`, `server` |
| GET | `/api/action-paths` | Reverse BFS from an action object to entry points. Params: `type`, `id`, `app`, `server` |
| GET | `/api/callers` | Direct callers of a process (one hop). Params: `id`, `server` |
| GET | `/api/db-action/:id` | SQL statement + fields for a Database action |
| GET | `/api/compare-action/:id` | Operands + operator for a Compare action |
| GET | `/api/calc-action/:id` | Formula rows for a Calculate action |
| GET | `/api/list-action/:id` | Operator + operands for a List action |
| GET | `/api/dialog-action/:id` | Field/prompt/validation rows for a Dialog |
| GET | `/api/dialog-screen/:id` | Screen format layout rows (for terminal grid mockup) |
| GET | `/api/generic-action/:type/:id` | Unified metadata for types 7,10-14,16-19 |
| GET | `/api/devices` | Device list from `ADV.dbo.t_device` — for Explorer env switcher |

### EAR Tester (port 9001)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/devices` | Same as above — populates entry-point dropdown (filtered to Virtual Terminal) |
| GET | `/api/tester/dialogs` | BFS from entry point → reachable dialogs. Params: `server`, `entry`, `app` |
| GET | `/api/tester/dynamic-menus` | Dynamic `_`-prefixed menus reachable from entry point. Params: `server`, `entry`, `app` |
| POST | `/api/tests/run` | Spawns `Run-Tests.ps1`. Params: `app`, `proc`, `entry` |
| GET | `/api/tests/status` | Returns `{ running: true/false }` |
| GET | `/api/tests/results` | Reads `ear-tester/_json_log.txt` → test result JSON |
| POST | `/api/launch-virtterm` | Spawns `VirtTerm.exe` detached |

### Graph cache (shared)
- `getGraph(server, app)` — builds and caches the full call graph for 15 min
- Returns `{ adjacency: Map<procId → [{childId, childName}]>, nameOf: Map<id→name>, dialogIds: Set }`
- Q1 = all process→process edges from `t_app_process_object_detail` (type=1)
- Q2 = dialog IDs from `t_act_dialog`
- Q3 = DB actions whose SQL contains `t_menu` (dynamic menu callers)
- Q4 = `t_menu` item texts for those callers
- Dynamic `_`-prefixed menu nodes injected as virtual BFS nodes (`MENU:_Name`)
- First load ~1.6 s; subsequent calls <10 ms

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
+-- [H] #32770  "Virtual Terminal Configuration"   ← HIDDEN config dialog
|       +-- [H] Edit [ID=1000]  ← Host Server Name  (e.g. "172.26.161.132")
|       +-- [H] Edit [ID=1001]  ← Host Port Number  (e.g. "4400")
|       +-- [H] Edit [ID=1002]  ← Device Name       (e.g. "WAVTUAT10")
|       +-- [H] Button [ID=1]   "&OK"
|       +-- [H] Button [ID=2]   "&Cancel"
|       +-- [H] Static x3       "Host Server Name:" / "Host Port Number:" / "Device Name:"
+-- [V] ADV_Virtual_Terminal  "Advantage Virtual Terminal"   ← MAIN visible window
|       L__ [V] ScrnClass  "Advantage Virtual Terminal"      ← custom-painted terminal
|               +-- [H] Edit  "ConsoleEcho"   ← FULL SCREEN TEXT (HIDDEN — do NOT skip)
|               +-- [V] Button [ID=903-914]   F1 … F12
|               L__ [H] ScrollBar [ID=924]
+-- [H] MSCTFIME UI
L__ [H] IME  "Default IME"
```

### Key facts
- **All screen text** lives in the single **hidden** `Edit "ConsoleEcho"` control (child of ScrnClass).
  Read via `GetWindowText` (= `WM_GETTEXT`). Buffer 4096 chars covers all 24 rows × 80 cols.
  `ScrnClass` custom-paints it — the Edit content is the authoritative source.
- **Config dialog** (`#32770`) is Hidden — VirtTerm connects on startup using stored settings.
  To switch server: `ShowWindow(hwnd, SW_SHOW)` → set [ID=1000] host, [ID=1001] port, [ID=1002] device → `PostMessage` click OK [ID=1].
- **To send keystrokes**: `SendKeys::SendWait` works (brings window to foreground first).
  Alternatively `PostMessage(ScrnClass, WM_CHAR, ...)` for background sending.
- **`_vtree.ps1`**: PowerShell script in repo root — run it while VirtTerm is open to re-dump the full control tree with IDs, visibility flags, and Edit content.

### VirtTerm.ps1 Bug Status (updated 2026-04-14)

**Bug 1 — `Get-VirtTermScreen` — FIXED (commit 733c8b9 in ear-tester)**
Old code skipped hidden windows, missing ConsoleEcho entirely.
Fixed: walks all children via ScrnClass → finds Edit grandchild → returns full text.
```powershell
function Get-VirtTermScreen {
    if ($script:VTHwnd -eq [IntPtr]::Zero) { return "" }
    foreach ($child in [WinApi]::GetChildWindows($script:VTHwnd)) {
        if ([WinApi]::GetClass($child) -eq "ScrnClass") {
            foreach ($grand in [WinApi]::GetChildWindows($child)) {
                if ([WinApi]::GetClass($grand) -eq "Edit") {
                    return [WinApi]::GetText($grand)
                }
            }
        }
    }
    return ""
}
```
`virtterm-tests.ps1` `$screen.Count -eq 0` check also fixed → `[string]::IsNullOrWhiteSpace($screen)`.

**Bug 2 — `Get-VirtTermHwnd` fallback scope bug — FIXED (commit 60422c8)**
Root cause: `$hwnd = $h` inside `EnumWindows` script-block created a local variable, never updating the outer `$hwnd`.
Fix: added `FindWindowByPid(int pid)` static method to the C# `WinApi` class. It runs `EnumWindows` in C# where closures capture by reference correctly. `Get-VirtTermHwnd` now calls `[WinApi]::FindWindowByPid($script:VTProcess.Id)` in the fallback path.
Also added: `if (-not ([System.Management.Automation.PSTypeName]'WinApi').Type)` guard around `Add-Type` to prevent "type already defined" errors when dot-sourced twice in the same session.

**Bug 3 — `Send-VirtTermKey` — FALSE ALARM**
What appeared garbled in terminal output was terminal line-wrapping at 80 cols.
The actual file content is correct — `[ValidateSet(...)]`, `[string]$Key`, and `$map` are all intact.

---

---

## EAR Explorer Features — Complete List

### Search
- **All 16 action types** searchable via checkbox dropdown: Process(1), Calc(3), Compare(4), DB(5), Dialog(6), Execute(7), List(9), Publish(10), Receive(11), Report(12), Send(13), User(14), Locale(16), Field(17), Constant(18), Record(19)
- **Database** search looks inside the SQL statement text (not just action name) — shows amber **🔍 matched in SQL** badge when action name itself doesn't match
- Results deduplicated via DISTINCT; ordered by action_name

### Search Result Click
- Clicking any result opens the **parent process**, expands the containing group, scrolls to the matching row, and **flashes it purple** (1.6 s animation)
- **For non-Process types**: automatically triggers the detail panel (no second click needed)
- Sub-line shows **⚙️ in: ParentProcessName** for action results

### Process Detail View
- Steps grouped by action type (header rows with toggle expand/collapse)
- **Right-click any row** → context menu with:
  - 📋 Copy path to here (breadcrumb)
  - 🗺 Copy all entry-point paths (reverse BFS, roots only)
- Process-type rows (type=1): click name cell → drill into subprocess
- All other types: click row → detail panel on right

### Detail Panels
- **Database (5)**: SQL statement in monospace box, field list
- **Compare (4)**: operand1 operator operand2 expression
- **Calculate (3)**: formula rows (target ← source/constant)
- **List (9)**: operands and operator
- **Dialog (6)**: field/prompt/validation rows + terminal screen mockup
- **Generic (7,10-14,16-19)**: name + description
- **Search term highlighted in yellow** (`<mark class="search-hl">`) across ALL detail panels

### "Who calls this?" (Reverse BFS)
- Group header has 📋 button → copies all entry-point paths for that process
- Right-click also gives 🗺 Copy all entry-point paths
- Paths table: shows all ancestors; roots marked with green "entry" badge
- **Only root nodes** emitted by `/api/action-paths` (fixed the 39,000-line explosion)

### Clipboard
- `writeToClipboard(text)` — tries `navigator.clipboard` first, falls back to `textarea + execCommand('copy')` for HTTP/IP-based deployments (no HTTPS required)

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

## EAR Tester Features — Current State

### What works
- **Reachable Dialogs panel**: BFS from selected entry point → all reachable dialogs + every call path
  - Hover tooltip shows all paths with color coding (green=outbound, orange=inbound, blue=ECom, grey=transfer)
  - Right-click → 📋 Copy all paths
- **Test results table**: reads `_json_log.txt`, shows PASS/FAIL/ERR with timing and detail
- **▶ Run Tests button**: POSTs to `/api/tests/run` → spawns `Run-Tests.ps1` via PowerShell
- **⟳ Refresh**: re-reads log file; polls `/api/tests/status` every 2.5 s while running
- **🖥 VirtTerm button**: launches `VirtTerm.exe` detached via `/api/launch-virtterm`
- **Server switcher**: ArcadiaWHJSqlStage / RetailRHjsqldev / RetailRHjsqlStage
- **Entry-point dropdown**: loads Virtual Terminal devices from `ADV.dbo.t_device`

### What is broken / not yet working
1. **`Get-VirtTermScreen` returns empty** → see Bug 1 above → logon test always times out
2. ~~**`Get-VirtTermHwnd` fallback broken**~~ → FIXED — now uses C# `FindWindowByPid`
3. **`Send-VirtTermKey` param block may be garbled** → see Bug 3 above → dot-source may fail
4. **No automated logon test passing** — the full sequence (launch → wait for login screen → type user/pass → wait for menu) has never successfully completed because screen reads return nothing

### Run-Tests.ps1 test sequence (intended)
```
Suite: VirtTerm
1. Launch VirtTerm (or find existing)
2. Wait for login prompt (screen contains "User ID" or "Login")
3. Type username + Enter
4. Wait for "Password" prompt
5. Type password + Enter
6. Wait for main menu screen
7. [Future] Navigate to specific dialog and verify screen content
8. Teardown (close VirtTerm or send disconnect)
```

### _json_log.txt format
```json
{
  "runAt": "2026-04-13T10:00:00Z",
  "baseUrl": "http://localhost:9001",
  "passed": 2, "failed": 1, "errors": 0, "total": 3,
  "results": [
    { "suite": "VirtTerm", "name": "Launch VirtTerm", "status": "PASS", "ms": 1240, "detail": "" },
    { "suite": "VirtTerm", "name": "Wait for Login", "status": "FAIL", "ms": 30000, "detail": "Timed out waiting for 'User ID'" }
  ]
}
```

---

## Pending / Next Steps

### VirtTerm / Tester
1. ✅ **`Get-VirtTermScreen` fixed** — reads ConsoleEcho hidden Edit via ScrnClass (commit 733c8b9)
2. ✅ **`Send-VirtTermKey` was fine** — terminal display artifact, not real corruption
3. **`Get-VirtTermHwnd` scope bug** — still open but mitigated; fix if needed with List capture
4. **End-to-end logon test** — next priority: launch → wait for "User ID" prompt → send real credentials → wait for main menu → verify screen content.
   - **Credentials source:** `AAD.dbo.t_employee` — columns: `id` (username), `password` (plaintext), `status` (A=Active/T=Terminated), `menu_level`, `emp_number`, `wh_id`
   - **Test user chosen:** `id=000002` / `password=00002` — Vogel, Charles H.E., status=A, menu_level=WHSSUPUSER, wh_id=1
   - Credentials updated in `virtterm-tests.ps1` (commit in ear-tester). No longer placeholder values.
5. **Automated VirtTerm config** — show hidden `#32770` dialog → set ID=1000 (host), ID=1001 (port), ID=1002 (device) → click OK (ID=1) — so tests can connect to any environment without manual setup.
6. **ear-tester has no GitHub remote** — changes committed locally only. Set up remote with `git remote add origin <url>` if needed.

### EAR Explorer (nice to have)
- Paths table: filter option to show only entry-point rows (hide intermediate ancestors)
- Persist server/app selection across page refresh via `localStorage`

### VirtTerm Screen Recorder (NOT YET BUILT — proposed design)
As you navigate VirtTerm screens, record the full `ConsoleEcho` text at each step
so future runs can validate against it.
- `POST /api/vt/screen` — reads ConsoleEcho via inline PowerShell + Win32, returns `{screen}`
- `POST /api/vt/recording` — saves `{name, steps:[{label, screen}]}` → `recordings/{name}.json`
- `GET  /api/vt/recording/:name` — loads a recording
- **Tester UI**: "🔴 Record" button → label input + "📸 Capture" + "⏹ Stop"
- **Compare mode**: load recording → navigate → auto-diff actual vs expected per step

### Dynamic Menu Downstream Links
`t_menu.text` items may link to real process objects via another table (`t_task`?).
Confirm the table and extend BFS to show full paths through menu items.
