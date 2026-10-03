import "./globals.css";

export const metadata = {
  title: "LinkTide",
  description: "AI-powered backlink discovery and directory submission"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
