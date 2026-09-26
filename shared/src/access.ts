import { z } from "zod";

/**
 * Page visibility and membership: pure predicates shared by the API, the MCP tools, the CLI and the
 * web UI so every surface agrees on who may do what.
 *
 * - public pages: anyone may read; the owner, admins and editors may edit; any signed-in user may comment.
 * - private pages: only the owner and members may read or comment; admins and editors may edit;
 *   the owner and admins may invite, manage members and change the visibility; only the owner may delete.
 */

export type PageVisibility = "public" | "private";
export const PAGE_VISIBILITIES = ["public", "private"] as const;
export const pageVisibilitySchema = z.enum(PAGE_VISIBILITIES);

export type MemberRole = "admin" | "editor" | "viewer";
export const MEMBER_ROLES = ["admin", "editor", "viewer"] as const;
export const memberRoleSchema = z.enum(MEMBER_ROLES);

/** The owner is implicit (not stored in members). */
export type PageRole = "owner" | MemberRole;

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export const ROLE_DESCRIPTIONS: Record<PageRole, string> = {
  owner: "Full control: edit, comment, share, change visibility, delete.",
  admin: "Edit, comment, invite and manage members, change visibility.",
  editor: "Edit and comment.",
  viewer: "Read and comment.",
};

/** The minimal page shape the predicates need (page docs, DTOs and summaries all satisfy it). */
export interface AccessSubject {
  ownerId: string;
  visibility?: PageVisibility | null;
  members?: Record<string, MemberRole> | null;
}

export function isPrivate(page: { visibility?: PageVisibility | null }): boolean {
  return page.visibility === "private";
}

function isMemberRole(v: unknown): v is MemberRole {
  return v === "admin" || v === "editor" || v === "viewer";
}

/** The viewer's role on a page, or null for anonymous users and non-members. */
export function roleFor(page: AccessSubject, uid: string | null | undefined): PageRole | null {
  if (!uid) return null;
  if (page.ownerId === uid) return "owner";
  const r = page.members?.[uid];
  return isMemberRole(r) ? r : null;
}

export function canView(page: AccessSubject, uid: string | null | undefined): boolean {
  return !isPrivate(page) || roleFor(page, uid) !== null;
}

export function canEdit(page: AccessSubject, uid: string | null | undefined): boolean {
  const r = roleFor(page, uid);
  return r === "owner" || r === "admin" || r === "editor";
}

/** Commenting needs a signed-in user; on private pages it also needs a role. */
export function canComment(page: AccessSubject, uid: string | null | undefined): boolean {
  if (!uid) return false;
  return !isPrivate(page) || roleFor(page, uid) !== null;
}

export function canManageMembers(page: AccessSubject, uid: string | null | undefined): boolean {
  const r = roleFor(page, uid);
  return r === "owner" || r === "admin";
}

export function canChangeVisibility(page: AccessSubject, uid: string | null | undefined): boolean {
  return canManageMembers(page, uid);
}

export function canDelete(page: AccessSubject, uid: string | null | undefined): boolean {
  return roleFor(page, uid) === "owner";
}

/** `tito@example.com` -> `t***@example.com`; used in invite previews so the page never reveals a full address. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local[0]}***@${domain}`;
}
