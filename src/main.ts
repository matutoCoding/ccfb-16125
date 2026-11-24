import './styles.css';
import { store } from './core/store';
import { renderApp } from './app';

const root = document.getElementById('app')!;
void store.init().then(() => renderApp(root));
