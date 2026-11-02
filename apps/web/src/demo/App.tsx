import { useEffect } from 'react';

export default function App() {
  useEffect(() => {
    document.title = 'de-class — демо';
  }, []);

  return (
    <main className="page">
      <header className="header">
        <h1>de-class</h1>
        <p className="subtitle">Демо тренажёра немецкого</p>
      </header>
      <p className="banner">Демо. Прогресс хранится только в этом браузере и может быть потерян при очистке данных.</p>
      <section className="card">
        <p>Демо-упражнения появятся в следующей версии.</p>
      </section>
      <footer>
        <a href="/">Личный кабинет</a>
      </footer>
    </main>
  );
}
