/**
 * app/admin/layout.tsx — M8
 *
 * Next.js App Router layout segment for all /admin/* pages.
 * Wraps every admin page with AdminLayout, which provides the sidebar,
 * top bar, and the client-side role guard (redirect to /login or
 * /parent/dashboard if the user is not an admin).
 *
 * This file is a Server Component by default (no 'use client' directive).
 * The actual guard logic lives in AdminLayout (a Client Component) because
 * it needs useAuth() and useRouter().
 */

import AdminLayout from '@/components/layouts/AdminLayout';

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminLayout>{children}</AdminLayout>;
}
