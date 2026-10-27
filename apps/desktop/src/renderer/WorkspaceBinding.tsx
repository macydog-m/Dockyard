import React, { useState } from 'react';
import { t } from '../i18n';

export function WorkspaceBinding({ workspaceId }: { workspaceId: string }) {
  const [config, setConfig] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return <details className="workspace-binding"><summary>{t('工作区绑定')}</summary>
    <p>{t('未绑定的查询跟随全局工作区；固定绑定的查询保持原工作区。')}</p><code>{workspaceId}</code>
    <button disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const result = await window.dockyard.bindingConfig(workspaceId);
        if (result.ok) { setConfig(result.value); setMessage(''); } else setMessage(result.message);
      } finally { setBusy(false); }
    }}>{t('生成项目绑定配置')}</button>
    {config && <><p>{t('将此段合并到项目的 .codex/config.toml，并在受信任的项目中重新启动 MCP。')}</p><pre>{config}</pre><button onClick={async () => {
      const result = await window.dockyard.copyText(config); setMessage(result.ok ? t('绑定配置已复制') : result.message);
    }}>{t('复制绑定配置')}</button></>}
    <p>{t('只影响后续查询，不清除会话历史，也不改变文件访问权限。任务自动识别尚未启用。')}</p>
    {message && <p role="status">{message}</p>}
  </details>;
}
