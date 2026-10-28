import './globals.css';
import SessionProvider from './_components/SessionProvider';
import AppHeader from './_components/AppHeader';
import AppFooter from './_components/AppFooter';

export const metadata = {
  title: 'Interview Practice',
  description: 'Practice spoken interviews based on your resume.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <a className="skip-link" href="#main-content">Skip to content</a>
          <div className="app-shell"><AppHeader /></div>
          <main id="main-content">{children}</main>
          <AppFooter />
        </SessionProvider>
      </body>
    </html>
  );
}
