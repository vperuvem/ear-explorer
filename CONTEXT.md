# EAR Explorer / EAR Tester — Session Context

## Ports
| App | Port |
|---|---|
| EAR Explorer | 9000 |
| EAR Tester | 9001 |

## Key Files
| File | Purpose |
|---|---|
| `server.js` | Express server for both apps |
| `public/index.html` | EAR Explorer UI |
| `public/tester.html` | EAR Tester UI |
| `_vtree.ps1` | Win32 window tree enumerator for VirtTerm |

## Keyword Colours (Explorer)
- **Green** — Outbound
- **Orange** — Inbound
- **Blue** — ECom / Exp
- **Grey** — Transfer / Tfr

---

## Servers & DB
- `ArcadiaWHJSqlStage` (default) · `RetailRHjsqldev` · `RetailRHjsqlStage`
- DB: `EAR` (mssql/msnodesqlv8, Windows auth)
- ADV schema also used (`ADV.dbo.t_device`, `ADV.dbo.t_menu`, `ADV.dbo.t_solution`)

---

## Work Completed This Session

### EAR Explorer
- **Route fixes**: renamed all `/api/db|compare|calc|list|dialog` → `-action` suffix
  so client fetches match server routes (was returning 404 HTML → JSON parse error).
- **HTML encoding**: `esc2()` helper applied to all detail panel fields
  (db/compare/calc/list/dialog) — fixes `<` `>` in SQL statements breaking UI.
- **Copy path (right-click)**: context menu on every step row.
  Path format: `FromProcess → StepLabel → NextProcess → … → ClickedAction`
  `navStack` now stores `{ backLabel, navLabel }` — navLabel is `r.label` of the
  clicked step, giving full context of how you drilled through each process.

### EAR Tester — Reachable Dialogs
- BFS call graph cached per `server|app` key (15 min TTL).
  First load ~1 s; subsequent entry-point switches <10 ms.
- Dynamic `_`-prefixed menus (from `ADV.dbo.t_menu`) injected as virtual BFS nodes:
  `*Task Menu → MENU:_Exp → TargetProcess`
- DB calls touching `t_menu` identified via `t_app_object_step.statement LIKE '%t_menu%'`.
- Grid shows 637 dialogs + 14 dynamic menu rows; menu rows show `t_menu.text` items
  as the final path step.

### EAR Tester — Launch VirtTerm
- **Button**: green `🖥 VirtTerm` in Tester header.
- **Endpoint**: `POST /api/launch-virtterm` → spawns
  `C:\Users\PVenkatesh\Downloads\VirtualScanner\x86\VirtTerm.exe` detached.
- VirtTerm connects using its pre-configured registry/AppData settings.

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
