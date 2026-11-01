import { Icon } from './icon';
import './software-mark.css';

/** A software or modloader mark on a tile tinted with its colour. `original` is the server's own setup. */
export function SoftwareMark(props: { software: string; icon: string; size?: 'sm' | 'lg' }) {
  return (
    <span data-vesta="software-mark" data-software={props.software} data-size={props.size ?? 'sm'} aria-hidden="true">
      <Icon name={props.icon} size={props.size === 'lg' ? 30 : 18} />
    </span>
  );
}
