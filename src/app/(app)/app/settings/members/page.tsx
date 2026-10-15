import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { listInvites, listMembers } from '@/lib/repo';
import { AdminOnly } from '@/components/settings/admin-only';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { InviteForm, MemberRowActions, InviteRowActions } from '@/components/settings/members-actions';
import { formatDateInZone, formatInZone, initials } from '@/lib/utils';

export const metadata: Metadata = { title: 'Settings · Members' };

export default async function MembersSettingsPage() {
  const workspace = await requireWorkspace();
  if (workspace.role === 'member') {
    return <AdminOnly action="Inviting people and changing their roles" />;
  }

  const [members, invites] = await Promise.all([listMembers(workspace.org.id), listInvites(workspace.org.id)]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Invite someone"
          description="They get a link that adds them to this workspace when they sign in. Links expire after seven days."
        />
        <CardBody>
          <InviteForm orgId={workspace.org.id} isOwner={workspace.role === 'owner'} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Members (${members.length})`} description="Owners and admins can change roles and remove people." />
        {members.length === 0 ? (
          <EmptyState title="No members" description="This workspace has no member rows, which should not happen. Create a workspace again or contact support." />
        ) : (
          <Table>
            <THead>
              <TH>Person</TH>
              <TH>Role</TH>
              <TH>Joined</TH>
              <TH align="right">Actions</TH>
            </THead>
            <TBody>
              {members.map((member) => (
                <TR key={member.user_id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#eef0f3] text-[11px] font-semibold text-[#41474f]">
                        {initials(member.profile?.display_name ?? member.user_id) || '·'}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {member.profile?.display_name ?? 'Unnamed'}
                        </span>
                        <span className="block truncate text-[12px] text-muted">
                          {member.profile?.email ?? 'No profile yet'}
                          {member.profile?.job_title ? ` · ${member.profile.job_title}` : ''}
                        </span>
                      </span>
                      {member.user_id === workspace.userId && (
                        <span className="ml-1 rounded bg-brand-soft px-1.5 py-[1px] text-[10.5px] font-medium text-brand-dark">
                          you
                        </span>
                      )}
                    </div>
                  </TD>
                  <TD>
                    <StatusBadge state={member.role} />
                  </TD>
                  <TD className="whitespace-nowrap text-[12.5px] text-muted">
                    {formatDateInZone(member.created_at, workspace.org.timezone)}
                  </TD>
                  <TD align="right">
                    <MemberRowActions
                      orgId={workspace.org.id}
                      userId={member.user_id}
                      role={member.role}
                      isSelf={member.user_id === workspace.userId}
                      canManage={workspace.role === 'owner' || workspace.role === 'admin'}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardHeader
            title={`Pending invites (${invites.length})`}
            description="Copy the link and send it yourself, or let the app email it."
          />
          <Table>
            <THead>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Sent</TH>
              <TH>Expires</TH>
              <TH align="right">Actions</TH>
            </THead>
            <TBody>
              {invites.map((invite) => (
                <TR key={invite.id}>
                  <TD className="text-[13px]">{invite.email}</TD>
                  <TD>
                    <Badge tone={invite.role === 'admin' ? 'brand' : 'neutral'}>{invite.role}</Badge>
                  </TD>
                  <TD className="whitespace-nowrap text-[12.5px] text-muted">
                    {formatInZone(invite.created_at, workspace.org.timezone, { dateStyle: 'medium', timeStyle: 'short' })}
                  </TD>
                  <TD className="whitespace-nowrap text-[12.5px] text-muted">
                    {formatInZone(invite.expires_at, workspace.org.timezone, { dateStyle: 'medium', timeStyle: 'short' })}
                  </TD>
                  <TD align="right">
                    <InviteRowActions orgId={workspace.org.id} inviteId={invite.id} token={invite.token} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
