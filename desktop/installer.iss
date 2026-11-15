; The Windows installer people download from fluxdev.org/download: a standard Inno Setup wizard (Welcome, Install location,
; Start menu folder, Shortcuts, Install, Finish) with a proper uninstaller in Windows' Installed apps.
; build_app.py builds the app's folder first and then runs the Inno Setup compiler on this file with:
;   /DAppDir=<the built app folder>  /DAppVersion=<desktop/VERSION>  /DBuildDir=<scratch folder holding the icon and wizard images>
; Per-user by default (no administrator prompt, installs under %LOCALAPPDATA%\Programs), and the person can choose "all users".
; Files written by Setup carry no "downloaded from the internet" mark, which the zip download did and which stopped the app starting.

#define AppName "D&D Companion"
#define AppExe "DnD Companion.exe"

[Setup]
AppId={{6F1D2C54-7B0E-4E6A-9C3D-5A2B8E41D7A9}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=fluxdev.org
AppPublisherURL=https://fluxdev.org
AppSupportURL=https://fluxdev.org
DefaultDirName={autopf}\DnD Companion
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
SetupIconFile={#BuildDir}\icon.ico
WizardStyle=modern
WizardImageFile={#BuildDir}\wizard-large-100.bmp,{#BuildDir}\wizard-large-150.bmp,{#BuildDir}\wizard-large-200.bmp
WizardSmallImageFile={#BuildDir}\wizard-small.bmp
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
RestartApplications=no
OutputDir={#OutDir}
OutputBaseFilename=DnD-Companion-Installer-{#AppVersion}-windows
VersionInfoVersion={#AppVersion}
VersionInfoCompany=fluxdev.org
VersionInfoDescription={#AppName} Installer
VersionInfoProductName={#AppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[InstallDelete]
Type: files; Name: "{app}\uninstall.ps1"
