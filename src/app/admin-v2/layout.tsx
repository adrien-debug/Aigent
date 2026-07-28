/**
 * Root segment marker for /admin-v2. Next.js resolves error.tsx/not-found.tsx
 * to the NEAREST boundary actually reached by routing — without a layout at
 * this segment, Next never "enters" admin-v2/ and a 404 under it falls
 * through to the ROOT src/app/not-found.tsx instead of admin-v2/not-found.tsx
 * (same reason src/app/admin/not-found.tsx exists — see its header comment).
 * This file's only job is to exist so that boundary is reachable.
 */
export default function AdminV2Layout({ children }: { children: React.ReactNode }) {
  return children
}
