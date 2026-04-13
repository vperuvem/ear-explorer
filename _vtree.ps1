## _vtree.ps1 – VirtTerm window hierarchy

Add-Type -TypeDefinition @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class VTWin {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr lp);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern int  GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern int  GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] public static extern int  GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] public static extern int  GetDlgCtrlID(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr wp, StringBuilder lp);
    public const uint WM_GETTEXT = 0x000D;
    public delegate bool EnumProc(IntPtr h, IntPtr lp);
    public static string Txt(IntPtr h) { int n=GetWindowTextLength(h); if(n==0) return ""; var s=new StringBuilder(n+1); GetWindowText(h,s,n+1); return s.ToString(); }
    public static string Cls(IntPtr h) { var s=new StringBuilder(256); GetClassName(h,s,256); return s.ToString(); }
    public static List<IntPtr> Children(IntPtr p) { var L=new List<IntPtr>(); EnumChildWindows(p,(h,_)=>{L.Add(h);return true;},IntPtr.Zero); return L; }
    public static List<IntPtr> TopLevel() { var L=new List<IntPtr>(); EnumWindows((h,_)=>{L.Add(h);return true;},IntPtr.Zero); return L; }
}
"@ -ReferencedAssemblies 'System.Collections'

$vtProc = Get-Process -Name VirtTerm -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $vtProc) {
    "Launching VirtTerm..."
    $vtProc = Start-Process 'C:\Users\PVenkatesh\Downloads\VirtualScanner\x86\VirtTerm.exe' -PassThru
    Start-Sleep 4
    $vtProc = Get-Process -Name VirtTerm -ErrorAction SilentlyContinue | Select-Object -First 1
}
[uint32]$vtPid = [uint32]$vtProc.Id
"VirtTerm PID = $vtPid"

$lines = [System.Collections.Generic.List[string]]::new()
$total = 0

function Node([IntPtr]$h, [string]$pre, [bool]$isLast) {
    $p2 = [uint32]0
    [VTWin]::GetWindowThreadProcessId($h, [ref]$p2) | Out-Null
    if ([uint32]$p2 -ne [uint32]$vtPid) { return }
    $script:total++
    $cls = [VTWin]::Cls($h)
    $txt = [VTWin]::Txt($h)
    $vis = if ([VTWin]::IsWindowVisible($h)) { 'V' } else { 'H' }
    $id  = [VTWin]::GetDlgCtrlID($h)
    $idS = if ($id -gt 0) { " [ID=$id]" } else { '' }
    $hdl = '0x{0:X}' -f $h.ToInt64()
    $val = ''
    if ($cls -match '^(Edit|ComboBox)') {
        $sb = New-Object System.Text.StringBuilder 4096
        [VTWin]::SendMessage($h, [VTWin]::WM_GETTEXT, [IntPtr]4096, $sb) | Out-Null
        if ($sb.Length -gt 0) { $val = " =`r`n" + ($sb.ToString() -split "`r?`n" | ForEach-Object { "        |  $_" } | Out-String) }
    }
    $cap = if ($txt) { " `"$txt`"" } else { '' }
    $br  = if ($isLast) { 'L__ ' } else { '+-- ' }
    $script:lines.Add("$pre$br[$vis] $cls$idS$cap$val  ($hdl)")

    $kids = [VTWin]::Children($h) | Where-Object {
        $kp = [uint32]0
        [VTWin]::GetWindowThreadProcessId($_, [ref]$kp) | Out-Null
        $kp -eq $vtPid -and [VTWin]::GetParent($_) -eq $h
    }
    $np = $pre + $(if ($isLast) { '    ' } else { '|   ' })
    for ($i = 0; $i -lt $kids.Count; $i++) {
        Node $kids[$i] $np ($i -eq $kids.Count - 1)
    }
}

$allTop = [VTWin]::TopLevel()
"Total top-level windows on desktop: $($allTop.Count)"
$roots = $allTop | Where-Object {
    $rp = [uint32]0; [VTWin]::GetWindowThreadProcessId($_, [ref]$rp) | Out-Null; [uint32]$rp -eq [uint32]$vtPid
}
"Root windows belonging to VirtTerm PID=$vtPid : $($roots.Count)"
$lines.Add("VirtTerm.exe  (PID=$vtPid)")
for ($i = 0; $i -lt $roots.Count; $i++) { Node $roots[$i] '' ($i -eq $roots.Count - 1) }

$lines | ForEach-Object { $_ }
""; "Total: $total windows"
