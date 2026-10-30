import { Button, Checkbox, Dialog } from '@vesta/ui';
import { For, Show, createMemo, createSignal, untrack } from 'solid-js';
import { Icon } from './icon';
import { t } from '../localization';
import './file-tree-picker.css';
export interface TreeEntry { path: string; directory?: boolean }
interface Node { path: string; name: string; children: Node[]; directory: boolean }
export function fileTree(entries: readonly TreeEntry[]): Node[] {
  const root: Node[] = [], nodes = new Map<string, Node>();
  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    let children = root;
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/');
      let node = nodes.get(path);
      if (!node) { node = { path, name, children: [], directory: index < parts.length - 1 || !!entry.directory }; nodes.set(path, node); children.push(node); }
      children = node.children;
    });
  }
  const sort = (items: Node[]) => { items.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)); items.forEach(node => sort(node.children)); };
  sort(root); return root;
}
const leaves = (node: Node): string[] => node.children.length ? node.children.flatMap(leaves) : [node.path];
export function FileTreePicker(props: { title: string; entries: readonly TreeEntry[]; selected: readonly string[]; onApply: (paths: string[]) => void; onClose: () => void }) {
  const [selected, setSelected] = createSignal<string[]>(untrack(() => [...props.selected]), { name: 'file-picker:selected' });
  const [expanded, setExpanded] = createSignal<string[]>([], { name: 'file-picker:expanded' });
  const tree = createMemo(() => fileTree([...props.entries, ...props.selected.filter(path => /[*?]/.test(path)).map(path => ({ path }))]));
  const all = () => tree().flatMap(leaves);
  const has = (path: string) => selected().some(value => path === value || path.startsWith(value + '/'));
  const toggle = (node: Node, checked: boolean) => {
    const next = new Set([...all().filter(has), ...selected().filter(path => /[*?]/.test(path))]);
    leaves(node).forEach(path => checked ? next.add(path) : next.delete(path));
    setSelected([...next]);
  };
  const rows = (nodes: Node[], depth = 0) => <For each={nodes}>{node => {
    const checked = () => leaves(node).every(has);
    const mixed = () => !checked() && leaves(node).some(has);
    const open = () => expanded().includes(node.path);
    return <div>
      <div data-vesta="file-picker-row" style={{ 'padding-inline-start': `${depth * 20}px` }}>
        <Show when={node.directory} fallback={<span data-vesta="file-picker-indent" />}>
          <Button size="sm" variant="ghost" aria-label={node.name} aria-expanded={open() ? 'true' : 'false'} icon={<Icon name={open() ? 'icons/controls/chevron-down' : 'icons/controls/chevron-right'} size={14} />} onClick={() => setExpanded(values => open() ? values.filter(value => value !== node.path) : [...values, node.path])} />
        </Show>
        <Checkbox label={node.name} checked={checked()} indeterminate={mixed()} onChange={value => toggle(node, value)} />
      </div>
      <Show when={open()}>{rows(node.children, depth + 1)}</Show>
    </div>;
  }}</For>;
  return <Dialog open size="lg" title={props.title} closeLabel={t('nav.close')} onOpenChange={open => { if (!open) props.onClose(); }} footer={<><Button variant="ghost" onClick={props.onClose}>{t('common.cancel')}</Button><Button tone="accent" onClick={() => props.onApply(selected())}>{t('server-files.save')}</Button></>}>
    <div data-vesta="file-picker">
      <Checkbox label={t('management.export-all')} checked={all().length > 0 && all().every(has)} indeterminate={all().some(has) && !all().every(has)} onChange={checked => setSelected(checked ? all() : [])} />
      <div data-vesta="file-picker-tree">{rows(tree())}</div>
    </div>
  </Dialog>;
}
