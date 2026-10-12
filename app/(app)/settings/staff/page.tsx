import { getCurrentStaff } from '@/lib/supabase/server';
import { AddStaffForm, StaffRow, type StaffMember } from './StaffForms';

export default async function StaffSettingsPage() {
  const { supabase, staff: me } = await getCurrentStaff();
  const { data } = await supabase
    .from('staff_user')
    .select('id, name, email, role, active, auth_user_id')
    .order('active', { ascending: false })
    .order('name');
  const people = (data ?? []).map((p) => ({ ...p, has_login: !!p.auth_user_id })) as StaffMember[];
  const invitesReady = !!process.env.SUPABASE_SECRET_KEY;

  return (
    <div className="space-y-5">
      {!invitesReady && (
        <p className="rounded border border-[#c98a1b]/40 bg-[#c98a1b]/10 px-3 py-2 text-sm">
          Email invites aren’t switched on yet. You can still add people here. To give them a login for now: in Supabase,
          go to Authentication, Users, Add user, Create new user, enter their email and a temporary password, and check
          Auto Confirm. They then use “First time, or forgot your password?” on the login page to set their own.
        </p>
      )}

      <section className="rounded border border-line bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">Add a staff member</h2>
        <AddStaffForm invitesReady={invitesReady} />
      </section>

      <section className="overflow-hidden rounded border border-line bg-white">
        <h2 className="border-b border-line bg-paper px-4 py-2 text-sm font-semibold">Staff ({people.filter((p) => p.active).length} active)</h2>
        <ul className="divide-y divide-line">
          {people.map((p) => (
            <StaffRow key={p.id} person={p} isMe={p.id === me?.id} invitesReady={invitesReady} />
          ))}
        </ul>
      </section>

      <p className="text-xs text-muted">
        Admin: everything, including Settings. Staff and Physician: all patient screens. Each person’s queue shows the
        steps for their role. Deactivated people can’t log in; their history stays in the audit log.
      </p>
    </div>
  );
}
