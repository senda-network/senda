; desktop/installer/hooks.nsh
;
; NSIS installer/uninstaller hooks for the ClosedMesh desktop bundle.
; Tauri's NSIS template injects these macros at the corresponding
; phases of the installer flow (see Tauri docs: bundle.windows.nsis.installerHooks).
;
; Why this exists: the .exe NSIS installer overwrites every file in
; the install directory. If `ClosedMesh.exe` is still running when a
; user upgrades, the bundled `node.exe` sidecar holds an exclusive
; file lock on itself — and the installer pops a modal:
;
;     Error opening file for writing:
;     C:\Users\…\AppData\Local\ClosedMesh\node.exe
;     Click Abort to stop the installation, Retry to try again, or
;     Ignore to skip this file.
;
; Two-step kill, in this order:
;
;   1. `taskkill /F /T /IM ClosedMesh.exe` — force-kill the desktop
;      window and its process tree. `/T` only catches descendants of
;      a *currently alive* parent though, so when the user has
;      previously closed the window (Tauri's prevent_close keeps the
;      process alive but a crash or earlier upgrade may have killed
;      ClosedMesh.exe and orphaned the sidecar) `node.exe` survives
;      this step.
;
;   2. PowerShell sweep that finds any `node.exe` whose full path
;      ends with `\ClosedMesh\node.exe` and kills it. Matching on
;      full path (not just image name) protects unrelated `node.exe`
;      processes the user might be running — a Node dev server, a
;      VS Code extension host, the Electron renderer of another
;      installed app.
;
; Sleep 800 ms after the kill to give the OS time to drop file locks
; before NSIS opens the destination files for writing. 500 ms was
; consistently enough on a fast NVMe; 800 ms keeps a margin for
; slower disks without making the install perceptibly slower.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping any running ClosedMesh instance..."
  nsExec::Exec 'taskkill /F /T /IM ClosedMesh.exe'
  Pop $0
  nsExec::Exec 'powershell -NoProfile -WindowStyle Hidden -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''*\ClosedMesh\node.exe'' } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $0
  Sleep 800
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping any running ClosedMesh instance..."
  nsExec::Exec 'taskkill /F /T /IM ClosedMesh.exe'
  Pop $0
  nsExec::Exec 'powershell -NoProfile -WindowStyle Hidden -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''*\ClosedMesh\node.exe'' } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $0
  Sleep 800
!macroend
