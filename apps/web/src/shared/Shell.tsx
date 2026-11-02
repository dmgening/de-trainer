import type { ReactNode } from 'react';
import { History } from './History';
import { Home } from './Home';
import { useRoute } from './router';
import { Summary } from './Summary';
import { Topics } from './Topics';
import { Training } from './Training';

const NAV = [
  ['', 'Главная'],
  ['topics', 'Темы'],
  ['history', 'История'],
  ['settings', 'Данные'],
] as const;

const TITLES: Record<string, string> = { train: 'Тренировка', summary: 'Итоги', topics: 'Темы и навыки', history: 'История', settings: 'Данные и настройки' };

/** Screens shared by the owner app and the demo; the settings screen and banners differ. */
export function Shell(props: { banner?: ReactNode; emptyBank: ReactNode; settings: ReactNode; title: string }) {
  const [screen = '', arg] = useRoute();
  let body: ReactNode;
  switch (screen) {
    case 'train':
      body = <Training />;
      break;
    case 'summary':
      body = <Summary sessionId={arg ?? ''} />;
      break;
    case 'topics':
      body = <Topics />;
      break;
    case 'history':
      body = <History sessionId={arg} />;
      break;
    case 'settings':
      body = props.settings;
      break;
    default:
      body = <Home banner={props.banner} emptyBank={props.emptyBank} />;
  }
  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          {props.title}
        </a>
        {screen !== '' && <h1 className="screen-title">{TITLES[screen] ?? ''}</h1>}
      </header>
      <main className="page" id="main">
        {screen !== '' && screen !== 'train' && props.banner}
        {body}
      </main>
      {screen !== 'train' && (
        <nav className="tabbar" aria-label="Разделы">
          {NAV.map(([path, label]) => (
            <a key={path} href={`#/${path}`} aria-current={screen === path ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
