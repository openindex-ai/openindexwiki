import type { Command } from "commander";
import { MEMBER_ROLES, type AcceptedInvite, type InvitePreview, type InviteResult, type MemberRole, type MembersResponse, type PageMember } from "@openindex/wiki-shared";
import { getClient, requireAuth } from "../context";
import { UsageError, fail, print, table } from "../output";

function parseRole(v: string | undefined): MemberRole | undefined {
  if (v === undefined) return undefined;
  if (!(MEMBER_ROLES as readonly string[]).includes(v)) throw new UsageError(`role must be one of ${MEMBER_ROLES.join(", ")}`);
  return v as MemberRole;
}

export function membersText(r: MembersResponse): string {
  const rows = [[r.owner.uid, r.owner.displayName, "owner"], ...r.members.map((m) => [m.uid, m.displayName, m.role])];
  const out = [`/page/${r.slug} (${r.visibility})${r.viewerRole ? ` · you: ${r.viewerRole}` : ""}`, table(rows, ["uid", "name", "role"])];
  if (r.invites?.length) {
    out.push("", "Pending invites:", table(r.invites.map((i) => [i.email, i.role, i.status, i.expiresAt.slice(0, 10), i.id]), ["email", "role", "status", "expires", "id"]));
  }
  return out.join("\n");
}

export function registerMemberCommands(program: Command) {
  program
    .command("share <slug> <email>")
    .description("Share a page you own or administer with an email address (existing accounts are added at once; others get an invite email)")
    .option("-r, --role <role>", `${MEMBER_ROLES.join(" | ")} (default viewer)`)
    .action(async (slug: string, email: string, opts: { role?: string }) => {
      try {
        const res = await requireAuth().invite(slug, { email, role: parseRole(opts.role) });
        print(res, (r: InviteResult) =>
          r.status === "added"
            ? `${r.updated ? "Changed" : "Added"} ${r.member.displayName} (${r.member.uid}) as ${r.member.role} on /page/${slug}${r.updated ? "" : r.emailSent ? "; email sent" : "; no email sent"}`
            : `Invited ${r.invite.email} as ${r.invite.role} to /page/${slug} (expires ${r.invite.expiresAt.slice(0, 10)}; email ${r.emailSent ? "sent" : "not sent"})`,
        );
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("members <slug>")
    .description("Owner, members and (for owner/admins) pending invites of a page you have access to")
    .action(async (slug: string) => {
      try {
        const res = await requireAuth().members(slug);
        print(res, membersText);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("unshare <slug> <uidOrEmail>")
    .description("Remove a member (by uid) or revoke a pending invite (by email)")
    .action(async (slug: string, target: string) => {
      try {
        const client = requireAuth();
        if (target.includes("@")) {
          const email = target.trim().toLowerCase();
          const { invites } = await client.members(slug);
          const invite = (invites ?? []).find((i) => i.email === email && i.status === "pending");
          if (!invite) throw new UsageError(`No pending invite for ${email} on /page/${slug}. To remove a member, pass their uid (see \`members ${slug}\`).`);
          await client.revokeInvite(slug, invite.id);
          print({ ok: true, revoked: invite.id, email }, () => `Revoked the invite for ${email} on /page/${slug}`);
          return;
        }
        await client.removeMember(slug, target);
        print({ ok: true, slug, uid: target }, () => `Removed ${target} from /page/${slug}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("role <slug> <uid> <role>")
    .description(`Change a member's role (${MEMBER_ROLES.join(" | ")})`)
    .action(async (slug: string, uid: string, roleArg: string) => {
      try {
        const role = parseRole(roleArg) as MemberRole;
        const { member } = await requireAuth().setMemberRole(slug, uid, role);
        print(member, (m: PageMember) => `${m.displayName} (${m.uid}) is now ${m.role} on /page/${slug}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("accept-invite <token>")
    .description("Accept a page invite (the token from the invite email link /invite/<token>); your account email must match")
    .option("--preview", "show the invite without accepting it")
    .action(async (token: string, opts: { preview?: boolean }) => {
      try {
        if (opts.preview) {
          const { invite } = await getClient().previewInvite(token);
          print(invite, (i: InvitePreview) => `${i.invitedByName} invited ${i.emailHint} to "${i.pageTitle}" (/page/${i.pageSlug}) as ${i.role} · ${i.status}${i.status === "pending" ? ` · expires ${i.expiresAt.slice(0, 10)}` : ""}`);
          return;
        }
        const { accepted } = await requireAuth().acceptInvite(token);
        print(accepted, (a: AcceptedInvite) => `You are now ${a.role} on "${a.pageTitle}": ${a.url}`);
      } catch (err) {
        fail(err);
      }
    });
}
