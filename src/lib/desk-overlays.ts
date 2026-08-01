// Command palette + keyboard help for the desk control plane.

import { el } from './render.js';
import { DESK_BINDINGS, formatBindingKeys, type DeskSurface } from './desk-keys.js';

export interface DeskCommand {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  group?: string;
  run: () => void;
}

export interface DeskOverlays {
  openPalette: () => void;
  openHelp: (surface?: DeskSurface) => void;
  close: () => void;
  isOpen: () => boolean;
  setCommands: (cmds: DeskCommand[]) => void;
  dispose: () => void;
}

export function installDeskOverlays(root: HTMLElement = document.body): DeskOverlays {
  let commands: DeskCommand[] = [];
  let paletteOpen = false;
  let helpOpen = false;
  let filter = '';
  let activeIdx = 0;

  const paletteEl = el('div', {
    class: 'desk-palette',
    hidden: true,
    role: 'dialog',
    'aria-label': 'Command palette',
  });
  const paletteInput = el('input', {
    class: 'desk-palette-input',
    type: 'text',
    placeholder: 'Go to surface, dispatch action…',
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  const paletteList = el('div', { class: 'desk-palette-list', role: 'listbox' });
  const paletteHint = el('div', { class: 'desk-palette-hint' },
    el('kbd', {}, '↑↓'),
    ' move · ',
    el('kbd', {}, 'enter'),
    ' run · ',
    el('kbd', {}, 'esc'),
    ' close',
  );
  paletteEl.append(
    el('div', { class: 'desk-palette-shell' },
      el('div', { class: 'desk-palette-head' },
        el('span', { class: 'desk-palette-title' }, 'Command'),
        el('span', { class: 'desk-palette-chord' }, formatBindingKeys('mod+k'), ' · ', ':'),
      ),
      paletteInput,
      paletteList,
      paletteHint,
    ),
  );

  const helpEl = el('div', {
    class: 'desk-help',
    hidden: true,
    role: 'dialog',
    'aria-label': 'Keyboard shortcuts',
  });
  const helpBody = el('div', { class: 'desk-help-body' });
  helpEl.append(
    el('div', { class: 'desk-help-shell' },
      el('div', { class: 'desk-help-head' },
        el('h2', { class: 'desk-help-title' }, 'Desk keys'),
        el('p', { class: 'desk-help-sub' }, 'Keyboard-first · vim / tmux muscle memory'),
        el('button', {
          class: 'btn btn--ghost desk-help-close',
          type: 'button',
          onclick: () => close(),
        }, 'Close'),
      ),
      helpBody,
      el('div', { class: 'desk-help-foot' },
        el('kbd', {}, '?'),
        ' or ',
        el('kbd', {}, formatBindingKeys('mod+/')),
        ' toggle · ',
        el('kbd', {}, 'esc'),
        ' close',
      ),
    ),
  );

  const backdrop = el('div', {
    class: 'desk-overlay-backdrop',
    hidden: true,
    onclick: () => close(),
  });

  root.append(backdrop, paletteEl, helpEl);

  function filtered(): DeskCommand[] {
    const q = filter.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const hay = `${c.label} ${c.hint || ''} ${c.keywords || ''} ${c.group || ''}`.toLowerCase();
      return hay.includes(q) || q.split(/\s+/).every((p) => hay.includes(p));
    });
  }

  function paintPalette(): void {
    const items = filtered();
    if (activeIdx >= items.length) activeIdx = Math.max(0, items.length - 1);
    paletteList.replaceChildren();
    if (!items.length) {
      paletteList.appendChild(el('div', { class: 'desk-palette-empty' }, 'No matching commands'));
      return;
    }
    items.forEach((cmd, i) => {
      const row = el('button', {
        class: `desk-palette-item${i === activeIdx ? ' desk-palette-item--active' : ''}`,
        type: 'button',
        role: 'option',
        'aria-selected': i === activeIdx ? 'true' : 'false',
        onclick: () => runIndex(i),
        onmouseenter: () => {
          activeIdx = i;
          paintPalette();
        },
      },
        el('span', { class: 'desk-palette-item-label' }, cmd.label),
        cmd.hint
          ? el('span', { class: 'desk-palette-item-hint' }, cmd.hint)
          : null,
        cmd.group
          ? el('span', { class: 'desk-palette-item-group' }, cmd.group)
          : null,
      );
      paletteList.appendChild(row);
    });
    const active = paletteList.querySelector('.desk-palette-item--active');
    active?.scrollIntoView({ block: 'nearest' });
  }

  function runIndex(i: number): void {
    const items = filtered();
    const cmd = items[i];
    if (!cmd) return;
    close();
    try { cmd.run(); } catch (err) { console.error(err); }
  }

  function onPaletteKey(ev: KeyboardEvent): void {
    if (!paletteOpen) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
      return;
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      activeIdx = Math.min(filtered().length - 1, activeIdx + 1);
      paintPalette();
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
      paintPalette();
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      runIndex(activeIdx);
      return;
    }
  }

  function openPalette(): void {
    if (helpOpen) closeHelpOnly();
    paletteOpen = true;
    filter = '';
    activeIdx = 0;
    paletteInput.value = '';
    backdrop.hidden = false;
    paletteEl.hidden = false;
    document.body.setAttribute('data-desk-overlay', 'palette');
    paintPalette();
    requestAnimationFrame(() => {
      paletteInput.focus();
      paletteInput.select();
    });
  }

  function paintHelp(surface?: DeskSurface): void {
    const groups: Array<{ id: string; title: string }> = [
      { id: 'global', title: 'Global' },
      { id: 'deck', title: 'Deck' },
      { id: 'dash', title: 'Dash' },
      { id: 'term', title: 'Terminal' },
      { id: 'chat', title: 'Chats' },
    ];
    helpBody.replaceChildren();
    for (const g of groups) {
      const bindings = DESK_BINDINGS.filter((b) => b.group === g.id);
      if (!bindings.length) continue;
      const section = el('section', {
        class: `desk-help-section${surface && g.id === surface ? ' desk-help-section--here' : ''}`,
      },
        el('h3', { class: 'desk-help-section-title' }, g.title),
        el('ul', { class: 'desk-help-list' },
          ...bindings.map((b) =>
            el('li', { class: 'desk-help-row' },
              el('kbd', { class: 'desk-help-keys' }, formatBindingKeys(b.keys)),
              el('span', { class: 'desk-help-desc' }, b.description),
            ),
          ),
        ),
      );
      helpBody.appendChild(section);
    }
  }

  function openHelp(surface?: DeskSurface): void {
    if (paletteOpen) closePaletteOnly();
    helpOpen = true;
    backdrop.hidden = false;
    helpEl.hidden = false;
    document.body.setAttribute('data-desk-overlay', 'help');
    paintHelp(surface);
  }

  function closePaletteOnly(): void {
    paletteOpen = false;
    paletteEl.hidden = true;
  }

  function closeHelpOnly(): void {
    helpOpen = false;
    helpEl.hidden = true;
  }

  function close(): void {
    closePaletteOnly();
    closeHelpOnly();
    backdrop.hidden = true;
    document.body.removeAttribute('data-desk-overlay');
  }

  paletteInput.addEventListener('input', () => {
    filter = paletteInput.value;
    activeIdx = 0;
    paintPalette();
  });
  paletteInput.addEventListener('keydown', onPaletteKey);
  document.addEventListener('keydown', (ev) => {
    if (!helpOpen && !paletteOpen) return;
    if (paletteOpen) return; // handled on input
    if (ev.key === 'Escape' || ev.key === '?') {
      if (ev.key === '?' && helpOpen) {
        ev.preventDefault();
        close();
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
      }
    }
  }, true);

  return {
    openPalette,
    openHelp,
    close,
    isOpen: () => paletteOpen || helpOpen,
    setCommands: (cmds) => {
      commands = cmds;
      if (paletteOpen) paintPalette();
    },
    dispose: () => {
      close();
      try { backdrop.remove(); } catch { /* ignore */ }
      try { paletteEl.remove(); } catch { /* ignore */ }
      try { helpEl.remove(); } catch { /* ignore */ }
    },
  };
}

export function defaultDeskCommands(navigate: (hash: string) => void, extra: DeskCommand[] = []): DeskCommand[] {
  const base: DeskCommand[] = [
    { id: 'go-deck', label: 'Go to Deck', hint: 'g d', keywords: 'home start', group: 'navigate', run: () => navigate('#/deck') },
    { id: 'go-dash', label: 'Go to Dash', hint: 'g a', keywords: 'board agents roster', group: 'navigate', run: () => navigate('#/dash') },
    { id: 'go-term', label: 'Go to Terminal', hint: 'g t', keywords: 'shell pty tty', group: 'navigate', run: () => navigate('#/term') },
    { id: 'go-chats', label: 'Go to Chats', hint: 'g c', keywords: 'remote sessions', group: 'navigate', run: () => navigate('#/chats') },
    { id: 'go-settings', label: 'Go to Settings', hint: 'g s', keywords: 'prefs config', group: 'navigate', run: () => navigate('#/settings') },
    {
      id: 'new-shell',
      label: 'New shell tab',
      hint: 'ctrl-b c',
      keywords: 'terminal pty',
      group: 'term',
      run: () => {
        navigate('#/term');
        queueMicrotask(() => {
          document.dispatchEvent(new CustomEvent('grok-desk:term', { detail: { action: 'new', kind: 'shell' } }));
        });
      },
    },
    {
      id: 'new-grok-term',
      label: 'New grok terminal tab',
      hint: 'ctrl-b g',
      keywords: 'tui interactive',
      group: 'term',
      run: () => {
        navigate('#/term');
        queueMicrotask(() => {
          document.dispatchEvent(new CustomEvent('grok-desk:term', { detail: { action: 'new', kind: 'grok' } }));
        });
      },
    },
    {
      id: 'theme-cycle',
      label: 'Cycle theme',
      keywords: 'appearance color atelier',
      group: 'desk',
      run: () => {
        document.getElementById('theme-toggle')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      },
    },
  ];
  return [...base, ...extra];
}
