// 极简 DOM 构造辅助,避免引入框架
type ElProps<K extends keyof HTMLElementTagNameMap> = Partial<
  Omit<HTMLElementTagNameMap[K], 'style'>
> & {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration>;
  dataset?: Record<string, string>;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps<K> = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value as string;
    else if (key === 'style') {
      if (typeof value === 'string') el.setAttribute('style', value);
      else Object.assign(el.style, value);
    } else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else {
      (el as Record<string, unknown>)[key] = value;
    }
  }
  for (const child of children) {
    if (child == null) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function labeledField(label: string, input: HTMLElement): HTMLElement {
  return h('div', { class: 'field' }, [h('label', { textContent: label }), input]);
}

export function numberInput(value: number, step: number, onChange: (v: number) => void): HTMLInputElement {
  const input = h('input', { type: 'number', step: String(step), value: String(value) });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return input;
}

export function slider(
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): { wrap: HTMLElement; input: HTMLInputElement; out: HTMLOutputElement } {
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  const out = h('output', { textContent: value.toFixed(2) });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    out.textContent = v.toFixed(2);
    onChange(v);
  });
  return { wrap: h('div', { class: 'slider-row' }, [input, out]), input, out };
}
