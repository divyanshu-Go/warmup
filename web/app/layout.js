import './globals.css';

export const metadata = {
  title: 'Interview Practice',
  description: 'Practice spoken interviews based on your resume.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
