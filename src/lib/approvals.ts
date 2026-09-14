import { el } from './render.js';
import '../styles/approvals.css';

interface Request {
  id: string; agentId: string; agentName: string; title: string; detail: string; expiresAt: number;
  options: { optionId: string; name: string; kind: string }[];
}

export function installApprovals(): void {
  const button = el('button', { class: 'btn gr-requests', type: 'button', 'aria-haspopup': 'dialog' }, 'Requests (0)');
  const lock = el('form', { method: 'post', action: '/auth/logout' }, el('button', { class: 'btn', type: 'submit' }, 'Lock desk'));
  lock.onsubmit = event => { event.preventDefault(); void fetch('/auth/logout', { method: 'POST' }).then(() => location.assign('/login')); };
  document.querySelector('.topbar-right')?.prepend(button, lock);
  const dialog = el('dialog', { class: 'gr-approval-dialog', 'aria-labelledby': 'gr-approval-title' });
  const body = el('div');
  const status = el('p', { role: 'status' });
  dialog.append(el('h2', { id: 'gr-approval-title' }, 'Review tool requests'), el('p', {}, 'Approve once or reject. Unanswered requests cancel after two minutes.'), body, status,
    el('button', { class: 'btn', onclick: () => dialog.close() }, 'Close'));
  document.body.append(dialog);
  button.onclick = () => { if (!dialog.open) dialog.showModal(); };
  let current: Request[] = [];
  function render(requests: Request[]) {
    const added = requests.some(r => !current.some(old => old.id === r.id));
    current = requests; button.textContent = `Requests (${requests.length})`;
    button.classList.toggle('gr-requests--pending', requests.length > 0);
    body.replaceChildren();
    if (!requests.length) body.append(el('p', {}, 'No requests waiting.'));
    for (const request of requests) {
      const actions = el('div', { class: 'gr-approval-actions' });
      const card = el('section', { class: 'gr-approval-card' },
        el('p', {}, request.agentName), el('h3', {}, request.title), el('pre', {}, request.detail), actions);
      const decide = async (optionId: string | null) => {
        for (const control of actions.querySelectorAll('button')) control.disabled = true;
        try {
          const response = await fetch(`/api/permissions/${encodeURIComponent(request.agentId)}/${encodeURIComponent(request.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionId }) });
          if (response.status === 401) { location.assign('/login'); return; }
          if (!response.ok) throw new Error('Request expired or was resolved in another tab.');
          status.textContent = optionId ? 'Decision sent.' : 'Request rejected.';
        } catch (e) {
          status.textContent = e instanceof Error ? e.message : String(e);
          for (const control of actions.querySelectorAll('button')) control.disabled = false;
        }
      };
      actions.append(el('button', { class: 'btn', onclick: () => void decide(null) }, 'Reject'));
      for (const option of request.options.filter(o => o.kind === 'allow_once')) {
        actions.append(el('button', { class: 'btn btn--primary', onclick: () => void decide(option.optionId) }, 'Approve once'));
      }
      body.append(card);
    }
    if (added && !dialog.open) dialog.showModal();
  }
  render([]);
  const stream = new EventSource('/api/permissions/stream');
  stream.addEventListener('permissions', event => {
    try { render((JSON.parse((event as MessageEvent).data) as { requests: Request[] }).requests); }
    catch { status.textContent = 'Unable to read requests. Reload this desk.'; }
  });
  stream.onerror = () => {
    status.textContent = 'Connection interrupted. Reconnecting…';
    void fetch('/api/permissions').then(response => { if (response.status === 401) { stream.close(); location.assign('/login'); } }).catch(() => {});
  };
  window.addEventListener('pagehide', () => stream.close(), { once: true });
}
