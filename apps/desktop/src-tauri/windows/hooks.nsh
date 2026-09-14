; CorePOS stores irreplaceable business data under the Tauri AppData
; directories. Installer and uninstaller code must never remove those paths.
;
; Tauri invokes this hook before its built-in optional AppData cleanup. Force
; the state to disabled even for silent/passive uninstall, command-line state,
; or a previously selected checkbox value.
!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /F /IM CorePOS.exe'
  nsExec::ExecToLog 'taskkill /F /IM corepos-local-api.exe'
  ; Stop the local API before replacing the bundled sidecar during an update.
  nsExec::ExecToLog 'taskkill /F /IM bimik-cafe.exe'
  nsExec::ExecToLog 'taskkill /F /IM bimik-local-api.exe'
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $DeleteAppDataCheckboxState 0
!macroend
