import { useEffect, useRef } from 'react';

export type Notice = { id: string; text: string; tone?: 'info' | 'success' | 'danger' };

/**
 * 操作反馈提示（M38 后续）：查询/校准/导出这类「按钮的回复」不该混进行程正文里，
 * 否则会读成当天行程的一部分。统一放到视口顶部居中的浮层消息，右上角可关闭；
 * 普通提示 7 秒后自动收起，错误保留到用户关闭或下一次操作覆盖。
 */
function Toast({ notice, onClose }: { notice: Notice; onClose(id: string): void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (notice.tone === 'danger') return;
    const timer = window.setTimeout(() => closeRef.current(notice.id), 7000);
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.text, notice.tone]);
  return (
    <div className={`notice-toast notice-${notice.tone || 'info'}`} role={notice.tone === 'danger' ? 'alert' : 'status'} data-testid="notice-toast">
      <span className="notice-dot" aria-hidden="true" />
      <p>{notice.text}</p>
      <button type="button" aria-label="关闭提示" title="关闭提示" onClick={() => onClose(notice.id)}>×</button>
    </div>
  );
}

export default function NoticeStack({ notices, onClose }: { notices: Notice[]; onClose(id: string): void }) {
  if (!notices.length) return null;
  return <div className="notice-stack" role="region" aria-label="操作反馈">{notices.map(n => <Toast key={n.id} notice={n} onClose={onClose} />)}</div>;
}
