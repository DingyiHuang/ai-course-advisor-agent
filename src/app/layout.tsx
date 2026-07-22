import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI课程顾问 Agent",
  description: "面向学生、教师与机构的资料可追溯课程咨询助手",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
