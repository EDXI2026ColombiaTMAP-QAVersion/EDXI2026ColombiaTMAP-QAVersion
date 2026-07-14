begin;

-- Static GitHub Pages setup:
-- allow the browser to access Supabase directly with the publishable key.

grant usage on schema public to anon;

grant select, insert, update, delete
on table public.members
to anon;

grant select, insert, update, delete
on table public.brands
to anon;

grant select, insert, update, delete
on table public.daily_assignments
to anon;

drop policy if exists "Anon can read members" on public.members;
drop policy if exists "Anon can insert members" on public.members;
drop policy if exists "Anon can update members" on public.members;
drop policy if exists "Anon can delete members" on public.members;

drop policy if exists "Anon can read brands" on public.brands;
drop policy if exists "Anon can insert brands" on public.brands;
drop policy if exists "Anon can update brands" on public.brands;
drop policy if exists "Anon can delete brands" on public.brands;

drop policy if exists "Anon can read assignments" on public.daily_assignments;
drop policy if exists "Anon can insert assignments" on public.daily_assignments;
drop policy if exists "Anon can update assignments" on public.daily_assignments;
drop policy if exists "Anon can delete assignments" on public.daily_assignments;

create policy "Anon can read members"
on public.members
for select
to anon
using (true);

create policy "Anon can insert members"
on public.members
for insert
to anon
with check (true);

create policy "Anon can update members"
on public.members
for update
to anon
using (true)
with check (true);

create policy "Anon can delete members"
on public.members
for delete
to anon
using (true);

create policy "Anon can read brands"
on public.brands
for select
to anon
using (true);

create policy "Anon can insert brands"
on public.brands
for insert
to anon
with check (true);

create policy "Anon can update brands"
on public.brands
for update
to anon
using (true)
with check (true);

create policy "Anon can delete brands"
on public.brands
for delete
to anon
using (true);

create policy "Anon can read assignments"
on public.daily_assignments
for select
to anon
using (true);

create policy "Anon can insert assignments"
on public.daily_assignments
for insert
to anon
with check (true);

create policy "Anon can update assignments"
on public.daily_assignments
for update
to anon
using (true)
with check (true);

create policy "Anon can delete assignments"
on public.daily_assignments
for delete
to anon
using (true);

commit;
