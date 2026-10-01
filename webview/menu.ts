/** Minimal popover: anchored below an element, closes on outside click or Escape. */

let current: { el: HTMLElement; close: () => void } | undefined;

export function closePopover(): void {
  current?.close();
}

export function openPopover(anchor: HTMLElement, build: (close: () => void) => HTMLElement): void {
  closePopover();
  const el = document.createElement('div');
  el.className = 'popover';
  const onDown = (e: PointerEvent) => {
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
      close();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      anchor.focus();
    }
  };
  const close = () => {
    el.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (current?.el === el) {
      current = undefined;
    }
  };
  el.append(build(close));
  document.body.append(el);
  // Position below the anchor, kept inside the viewport.
  const rect = anchor.getBoundingClientRect();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const left = Math.min(rect.left, window.innerWidth - width - 8);
  const below = rect.bottom + 4;
  const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : below;
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${top}px`;
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  current = { el, close };
  el.querySelector<HTMLElement>('input, button')?.focus();
}

export interface MenuItem {
  label: string;
  /** Color dot shown before the label. */
  color?: string;
  checked?: boolean;
  /** Keep the menu open after selecting (for checkbox lists). */
  keepOpen?: boolean;
  onSelect: () => void;
}

export function menuList(items: MenuItem[], close: () => void, title?: string): HTMLElement {
  const list = document.createElement('div');
  list.className = 'menu';
  list.setAttribute('role', 'menu');
  if (title) {
    const h = document.createElement('div');
    h.className = 'menu-title';
    h.textContent = title;
    list.append(h);
  }
  for (const item of items) {
    const b = document.createElement('button');
    b.className = 'menu-item';
    b.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (item.checked !== undefined) {
      b.setAttribute('aria-checked', String(item.checked));
      const box = document.createElement('span');
      box.className = `menu-check${item.checked ? ' on' : ''}`;
      b.append(box);
    }
    if (item.color) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = item.color;
      b.append(dot);
    }
    b.append(item.label);
    b.addEventListener('click', () => {
      item.onSelect();
      if (item.keepOpen) {
        item.checked = !item.checked;
        b.setAttribute('aria-checked', String(item.checked));
        b.querySelector('.menu-check')?.classList.toggle('on', item.checked);
      } else {
        close();
      }
    });
    list.append(b);
  }
  return list;
}
