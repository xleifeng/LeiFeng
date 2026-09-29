'use strict';

const { execFile } = require('node:child_process');

// Windows 空闲探测：GetLastInputInfo 是会话级输入时间戳，与登录会话无关（loginctl 的
// IdleSinceHint 等价物）。P/Invoke 经 PowerShell 单次输出毫秒数，无第三方依赖。
const WINDOWS_IDLE_SCRIPT = [
  'Add-Type -Name Native -Namespace Win32 -MemberDefinition \'',
  '[StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }',
  '[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);',
  '\' > $null',
  '$info = New-Object Win32.Native+LASTINPUTINFO',
  '$info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][Win32.Native+LASTINPUTINFO])',
  'if (-not [Win32.Native]::GetLastInputInfo([ref]$info)) { exit 1 }',
  '$tickCount = [Environment]::TickCount -band [int32]::MaxValue',
  '$idle = $tickCount - $info.dwTime',
  'if ($idle -lt 0) { $idle += [uint32]::MaxValue + 1 }',
  'Write-Output $idle',
].join('\n');

class SystemIdleAdapter {
  constructor({ runner = execFile, powershellExe = process.env.THUNDERD_POWERSHELL || 'powershell.exe' } = {}) { this.runner = runner; this.powershellExe = powershellExe; this.available = false; this._probe(); }
  _windowsIdleMs() {
    return new Promise((resolve, reject) => {
      this.runner(this.powershellExe, ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_IDLE_SCRIPT], { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
        if (error) return reject(error);
        const value = Number(String(stdout || '').trim());
        if (!Number.isFinite(value) || value < 0) return reject(new Error('GetLastInputInfo returned invalid value'));
        resolve(value);
      });
    });
  }
  _probe() {
    if (process.platform === 'win32') { this._windowsIdleMs().then(() => { this.available = true; }, () => { this.available = false; }); return; }
    this.runner('loginctl', ['show-session', 'self', '-p', 'IdleSinceHintMonotonicUSec', '--value'], { encoding: 'utf8' }, (error, stdout) => { this.available = !error && /^\d+$/.test(String(stdout || '').trim()); });
  }
  isAvailable() { return this.available; }
  getIdleSeconds() {
    if (process.platform === 'win32') { return this._windowsIdleMs().then((ms) => ms / 1000); }
    return new Promise((resolve, reject) => { this.runner('loginctl', ['show-session', 'self', '-p', 'IdleSinceHintMonotonicUSec', '--value'], { encoding: 'utf8' }, (error, stdout) => { if (error) return reject(error); const value = Number(String(stdout || '').trim()); if (!Number.isFinite(value) || value <= 0) return resolve(0); const elapsedUs = Number(process.hrtime.bigint() / 1000n) - value; resolve(Math.max(0, elapsedUs / 1e6)); }); });
  }
  onActivity() { return () => {}; }
  close() {}
}

module.exports = { SystemIdleAdapter };
