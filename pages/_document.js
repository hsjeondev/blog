import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  const themeScript = `
    (function() {
      try {
        var params = new URLSearchParams(window.location.search);
        var queryTheme = params.get('theme') || params.get('mode');
        var queryDark = params.get('dark');
        var isQueryDark = queryTheme === 'dark' || queryDark === 'true' || queryDark === '1';
        var isQueryLight = queryTheme === 'light' || queryDark === 'false' || queryDark === '0';

        var theme = localStorage.getItem('theme') || 'system';
        var supportDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
        var isDark = isQueryDark || (!isQueryLight && (theme === 'dark' || (theme === 'system' && supportDarkMode)));
        if (isDark) {
          document.documentElement.classList.add('dark');
          document.documentElement.classList.remove('light');
          document.documentElement.style.colorScheme = 'dark';
        } else {
          document.documentElement.classList.add('light');
          document.documentElement.classList.remove('dark');
          document.documentElement.style.colorScheme = 'light';
        }
      } catch (e) {}
    })();
  `;

  return (
    <Html lang="ko">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <link rel="preconnect" href="https://hangeul.pstatic.net" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
