import { describe, expect, it } from "vitest";
import { canChangeVisibility, canComment, canDelete, canEdit, canManageMembers, canView, isPrivate, maskEmail, roleFor } from "../src/access";

const owner = "u_owner";
const admin = "u_admin";
const editor = "u_editor";
const viewer = "u_viewer";
const stranger = "u_stranger";
const members = { [admin]: "admin", [editor]: "editor", [viewer]: "viewer" } as const;
const privatePage = { ownerId: owner, visibility: "private" as const, members };
const publicPage = { ownerId: owner, visibility: "public" as const, members };
const legacyPage = { ownerId: owner }; // written before visibility/members existed

describe("roleFor", () => {
  it("resolves the owner, members, and nobody else", () => {
    expect(roleFor(privatePage, owner)).toBe("owner");
    expect(roleFor(privatePage, admin)).toBe("admin");
    expect(roleFor(privatePage, editor)).toBe("editor");
    expect(roleFor(privatePage, viewer)).toBe("viewer");
    expect(roleFor(privatePage, stranger)).toBeNull();
    expect(roleFor(privatePage, null)).toBeNull();
    expect(roleFor(privatePage, undefined)).toBeNull();
  });
  it("ignores unknown role values", () => {
    expect(roleFor({ ownerId: owner, members: { [stranger]: "root" as never } }, stranger)).toBeNull();
  });
});

describe("private pages", () => {
  it("are only visible to the owner and members", () => {
    expect(canView(privatePage, owner)).toBe(true);
    expect(canView(privatePage, admin)).toBe(true);
    expect(canView(privatePage, editor)).toBe(true);
    expect(canView(privatePage, viewer)).toBe(true);
    expect(canView(privatePage, stranger)).toBe(false);
    expect(canView(privatePage, null)).toBe(false);
  });
  it("are editable by owner, admins and editors only", () => {
    expect(canEdit(privatePage, owner)).toBe(true);
    expect(canEdit(privatePage, admin)).toBe(true);
    expect(canEdit(privatePage, editor)).toBe(true);
    expect(canEdit(privatePage, viewer)).toBe(false);
    expect(canEdit(privatePage, stranger)).toBe(false);
    expect(canEdit(privatePage, null)).toBe(false);
  });
  it("accept comments from every role, and from nobody else", () => {
    for (const uid of [owner, admin, editor, viewer]) expect(canComment(privatePage, uid)).toBe(true);
    expect(canComment(privatePage, stranger)).toBe(false);
    expect(canComment(privatePage, null)).toBe(false);
  });
  it("let owner and admins manage members and visibility", () => {
    expect(canManageMembers(privatePage, owner)).toBe(true);
    expect(canManageMembers(privatePage, admin)).toBe(true);
    expect(canManageMembers(privatePage, editor)).toBe(false);
    expect(canManageMembers(privatePage, viewer)).toBe(false);
    expect(canChangeVisibility(privatePage, admin)).toBe(true);
    expect(canChangeVisibility(privatePage, editor)).toBe(false);
  });
  it("can only be deleted by the owner", () => {
    expect(canDelete(privatePage, owner)).toBe(true);
    expect(canDelete(privatePage, admin)).toBe(false);
  });
});

describe("public pages", () => {
  it("are visible to everyone", () => {
    expect(canView(publicPage, stranger)).toBe(true);
    expect(canView(publicPage, null)).toBe(true);
    expect(canView(legacyPage, null)).toBe(true);
    expect(isPrivate({ ...legacyPage, visibility: undefined })).toBe(false);
    expect(isPrivate(privatePage)).toBe(true);
    expect(isPrivate(publicPage)).toBe(false);
  });
  it("keep member roles for editing", () => {
    expect(canEdit(publicPage, editor)).toBe(true);
    expect(canEdit(publicPage, viewer)).toBe(false);
    expect(canEdit(publicPage, stranger)).toBe(false);
    expect(canEdit(legacyPage, owner)).toBe(true);
    expect(canEdit(legacyPage, stranger)).toBe(false);
  });
  it("accept comments from any signed-in user", () => {
    expect(canComment(publicPage, stranger)).toBe(true);
    expect(canComment(legacyPage, stranger)).toBe(true);
    expect(canComment(publicPage, null)).toBe(false);
  });
});

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("tito@example.com")).toBe("t***@example.com");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
    expect(maskEmail("garbage")).toBe("***");
  });
});
